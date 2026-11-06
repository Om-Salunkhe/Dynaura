"""Meter loop: read every meter once a second, keep the latest state,
store raw readings, and roll them up into 1-minute summaries."""
import logging
import threading
import time
from typing import Callable

from hw import FLATS, METERS, Hardware
from signer import DeviceSigner
from store import Store

log = logging.getLogger("dynaura.meter")

MAX_FAILURES = 3  # this many failed reads in a row -> safe stop


class MeterLoop:
    def __init__(self, hw: Hardware, store: Store, signer: DeviceSigner | None = None, interval: float = 1.0):
        self.hw = hw
        self.signer = signer
        self.store = store
        self.interval = interval
        self.state: dict = {}
        self._minute: int | None = None
        self._acc: dict[str, dict] = {}
        self._summary_listeners: list[Callable[[list[dict]], None]] = []
        self._stop = threading.Event()
        self.failures = 0
        self.stopped_safe = False
        self._thread: threading.Thread | None = None

    # ---- listeners (Arkiv queue, 0G planner hook in later phases) -------
    def on_summary(self, fn: Callable[[list[dict]], None]) -> None:
        self._summary_listeners.append(fn)

    # ---- one tick --------------------------------------------------------
    def tick(self, now: float | None = None) -> dict:
        now = now or time.time()
        readings = self.hw.read_meters()
        sources = {f: self.hw.flat_source(f) for f in FLATS}

        rows = []
        for m in METERS:
            r = readings[m]
            src = "solar" if m == "panel" else sources[m]
            rows.append((m, r.v, r.ma, r.w, src))
        self.store.add_readings(now, rows)

        self._accumulate(now, readings, sources)

        self.state = {
            "ts": now,
            "meters": {m: readings[m].to_dict() for m in METERS},
            "flats": {f: {"source": sources[f], "away": self.hw.away(f)} for f in FLATS},
            "pump": {"on": self.hw.pump_on()},
            "solar_w": readings["panel"].w,
            "used_w": round(sum(readings[f].w for f in FLATS), 4),
        }
        return self.state

    def _accumulate(self, now: float, readings, sources) -> None:
        minute = int(now // 60 * 60)
        if self._minute is not None and minute != self._minute:
            self._flush()
        self._minute = minute
        for m in METERS:
            a = self._acc.setdefault(m, {"sum_w": 0.0, "n": 0, "solar_wh": 0.0})
            w = readings[m].w
            a["sum_w"] += w
            a["n"] += 1
            if m == "panel" or sources.get(m) == "solar":
                a["solar_wh"] += w * self.interval / 3600

    def partial(self) -> dict | None:
        """The minute in progress (not signed yet): {minute, panel_wh, used: {flat: solar Wh}}.
        Only for the demo's "sell now"; settlements use the signed 1-minute summaries."""
        minute, acc = self._minute, dict(self._acc)
        if minute is None or not acc:
            return None
        return {"minute": minute, "panel_wh": round((acc.get("panel") or {}).get("solar_wh", 0.0), 6),
                "used": {f: round((acc.get(f) or {}).get("solar_wh", 0.0), 6) for f in FLATS}, "sigs": []}

    def _flush(self) -> list[dict]:
        out = []
        for m, a in self._acc.items():
            if not a["n"]:
                continue
            out.append({
                "minute": self._minute,
                "meter": m,
                "avg_w": round(a["sum_w"] / a["n"], 4),
                "wh": round(a["sum_w"] * self.interval / 3600, 6),
                "solar_wh": round(a["solar_wh"], 6),
                "samples": a["n"],
            })
        self._acc = {}
        if self.signer:
            out = [self.signer.sign(s) for s in out]
        for s in out:
            self.store.add_summary(s)
        for fn in self._summary_listeners:
            try:
                fn(out)
            except Exception:
                log.exception("summary listener failed")
        return out

    def safe_stop(self, reason: str) -> None:
        """All flats to grid, pump off. Never raises."""
        try:
            self.hw.safe_stop()
        except Exception:
            log.exception("safe_stop itself failed")
        self.stopped_safe = True
        self.state = {**self.state, "safe_stop": {"active": True, "reason": reason, "ts": time.time()}}
        log.warning("SAFE STOP: %s", reason)

    # ---- thread ----------------------------------------------------------
    def _run(self) -> None:
        last_prune = 0.0
        while not self._stop.is_set():
            started = time.monotonic()
            try:
                self.tick()
                self.failures = 0
            except Exception:
                self.failures += 1
                log.exception("meter read failed (%d in a row)", self.failures)
                if self.failures >= MAX_FAILURES and not self.stopped_safe:
                    self.safe_stop("meter read failed")
            if time.time() - last_prune > 3600:
                self.store.prune()
                last_prune = time.time()
            self._stop.wait(max(0.0, self.interval - (time.monotonic() - started)))

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="meter-loop", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)
