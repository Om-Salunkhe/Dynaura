"""Sends records to the Arkiv bridge in the background. Arkiv never blocks the building:
if the bridge is down, the Pi keeps running and logs a warning."""
import logging
import queue
import threading
import time
from datetime import datetime

import httpx

import config

log = logging.getLogger("dynaura.arkiv")


class ArkivQueue:
    def __init__(self, store, loop=None, runner=None):
        self.store = store
        self.loop = loop
        self.runner = runner
        self.url = config.ARKIV_BRIDGE_URL.rstrip("/")
        self.q: queue.Queue[tuple[str, dict]] = queue.Queue(maxsize=500)
        self.ok = False
        self.last_error = None
        self._stop = threading.Event()

    # ---- producers -------------------------------------------------------
    def post(self, path: str, body: dict) -> None:
        try:
            self.q.put_nowait((path, body))
        except queue.Full:
            log.warning("Arkiv queue full, dropping %s", path)

    def on_summaries(self, summaries: list[dict]) -> None:
        self.post("/readings", {"summaries": summaries})

    def decision(self, decision_id: int) -> None:
        d = self.store.decision(decision_id)
        if not d:
            return
        self.post("/decision", {
            "decision_id": d["id"], "kind": d["kind"], "mode": d["mode"],
            "request_id": d["request_id"], "model": d["model"], "storage_root": d["storage_root"],
            # final names (DECISIONS 01:30); the old ones stay until the bridge reads these
            "og_request_id": d["request_id"], "og_storage_root": d["storage_root"],
            "summary": d["summary"] or "", "day": datetime.fromtimestamp(d["ts"]).strftime("%Y-%m-%d"),
            "_decision_id": d["id"],
        })

    def send_now(self, path: str, body: dict) -> dict:
        """Write and wait for the result (for admin actions that show the Arkiv key)."""
        return self._send(path, dict(body))

    # ---- reads -----------------------------------------------------------
    def history(self, days: int = 7) -> list[dict]:
        r = httpx.get(f"{self.url}/history", params={"days": days}, timeout=15)
        r.raise_for_status()
        return r.json()

    # ---- worker ----------------------------------------------------------
    def _send(self, path: str, body: dict) -> dict:
        decision_id = body.pop("_decision_id", None)
        on_reply = body.pop("_on_reply", None)  # e.g. keep the Arkiv key of a cleaning job
        if path == "/decision" and decision_id:
            # Read at send time: the 0G Storage root may have come in while this waited in the queue,
            # and a decision already on Arkiv gets the root patched in instead of a second entity.
            d = self.store.decision(decision_id) or {}
            body["storage_root"] = body["og_storage_root"] = d.get("storage_root") or body.get("storage_root")
            if d.get("arkiv_key"):
                body["arkiv_key"] = d["arkiv_key"]
        r = httpx.post(f"{self.url}{path}", json=body, timeout=60)
        r.raise_for_status()
        out = r.json()
        if decision_id and out.get("key"):
            self.store.set_decision(decision_id, arkiv_key=out["key"])
        if on_reply:
            try:
                on_reply(out)
            except Exception:
                log.exception("Arkiv reply callback failed")
        return out

    def _worker(self) -> None:
        while not self._stop.is_set():
            try:
                path, body = self.q.get(timeout=1)
            except queue.Empty:
                continue
            try:
                self._send(path, body)
                self.ok, self.last_error = True, None
            except Exception as e:
                self.ok, self.last_error = False, str(e)[:200]
                log.warning("Arkiv %s failed: %s", path, self.last_error)

    def _ticker(self) -> None:
        """Heartbeat every 30 s, today's totals every 10 min."""
        last_daily = 0.0
        while not self._stop.wait(30):
            st = self.loop.state if self.loop else {}
            self.post("/heartbeat", {
                "mode": (self.runner.status if self.runner else {}).get("mode", "unknown"),
                "flats": {f: v.get("source") for f, v in (st.get("flats") or {}).items()},
                "pump": (st.get("pump") or {}).get("on", False),
                "solar_w": st.get("solar_w", 0), "used_w": st.get("used_w", 0),
            })
            if time.time() - last_daily > 600:
                last_daily = time.time()
                for d in self.store.daily(1):
                    self.post("/daily", d)

    def start(self) -> None:
        threading.Thread(target=self._worker, name="arkiv-worker", daemon=True).start()
        threading.Thread(target=self._ticker, name="arkiv-ticker", daemon=True).start()

    def stop(self) -> None:
        self._stop.set()
