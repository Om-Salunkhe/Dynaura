"""Carries out the plan on the hardware, every 2 seconds.

- Flats go to solar inside the plan's solar window when the panel gives enough power.
- The overhead tank pump (the one wired job) runs once at its planned time.
- No plan (or 0G down) -> everything stays on grid.
"""
import logging
import threading
import time
from datetime import datetime

import config
from hw import FLATS

log = logging.getLogger("dynaura.jobs")


def _minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


class JobRunner:
    def __init__(self, hw, loop, brain, interval: float = 2.0):
        self.hw = hw
        self.loop = loop
        self.brain = brain
        self.interval = interval
        self.ran: set[tuple[str, str]] = set()
        self.status: dict = {"mode": "idle", "jobs": {}}
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def now(self) -> datetime:
        return self.hw.now() if hasattr(self.hw, "now") else datetime.now()

    def step(self) -> dict:
        plan = self.brain.plan
        now = self.now()
        today = now.strftime("%Y-%m-%d")
        minute = now.hour * 60 + now.minute
        panel_w = (self.loop.state.get("meters", {}).get("panel") or {}).get("w", 0.0)
        # The panel only shows power when flats draw from it, so also count the sim's sun when idle
        sun_ok = panel_w >= config.SOLAR_MIN_W or self._sun_available()

        if not plan or self.loop.stopped_safe:
            for f in FLATS:
                self.hw.set_flat(f, "grid")
            mode = "safe-stop" if self.loop.stopped_safe else (
                "no-ai" if (self.brain.decision or {}).get("mode") == "no-ai" else "no-plan")
            self.status = {"mode": mode, "jobs": {}}
            return self.status

        start, end = (_minutes(t) for t in plan["solar_window"])
        in_window = config.IGNORE_CLOCK or start <= minute < end
        for f in FLATS:
            want = "solar" if in_window and sun_ok and not self.hw.away(f) else "grid"
            if self.hw.flat_source(f) != want:
                self.hw.set_flat(f, want)

        jobs = {}
        for j in plan["jobs"]:
            s = _minutes(j["start"])
            running = s <= minute < s + j["minutes"]
            jobs[j["id"]] = "running" if running else ("done" if minute >= s + j["minutes"] else "planned")
            if j["id"] == "tank" and running and (today, "tank") not in self.ran:
                self.ran.add((today, "tank"))
                log.info("tank pump on for %ss (plan %s)", config.PUMP_SECONDS, j["start"])
                self.hw.run_pump(config.PUMP_SECONDS)
        self.status = {"mode": "plan", "in_window": in_window, "sun_ok": sun_ok, "jobs": jobs}
        return self.status

    def _sun_available(self) -> bool:
        frac = getattr(self.hw, "sun_fraction", None)
        return bool(frac and frac() * 4.6 >= config.SOLAR_MIN_W)

    def run_pump_now(self) -> None:
        self.hw.run_pump(config.PUMP_SECONDS)

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                self.step()
            except Exception:
                log.exception("job runner step failed")
            self._stop.wait(self.interval)

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="job-runner", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)


class PlanScheduler:
    """Makes tomorrow's plan every evening at PLAN_HOUR, and today's plan at start-up if missing."""

    def __init__(self, brain):
        self.brain = brain
        self._stop = threading.Event()

    def _try(self, which: str) -> None:
        try:
            self.brain.run_plan(which)
        except Exception as e:
            log.warning("planning (%s) failed: %s", which, e)

    def _run(self) -> None:
        today = datetime.now().strftime("%Y-%m-%d")
        if not self.brain.plan or self.brain.plan.get("date") != today:
            self._try("today")
        last_day = None
        while not self._stop.wait(60):
            now = datetime.now()
            if now.hour == config.PLAN_HOUR and last_day != now.date():
                last_day = now.date()
                self._try("tomorrow")

    def start(self) -> None:
        threading.Thread(target=self._run, name="plan-scheduler", daemon=True).start()

    def stop(self) -> None:
        self._stop.set()
