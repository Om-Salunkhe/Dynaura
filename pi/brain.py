"""Runs Dyna's daily plan and records every decision with its 0G proof."""
import logging
import threading
import time
from datetime import datetime

import planner
import zg
from forecast import forecast_day
from hw import FLATS

log = logging.getLogger("dynaura.brain")


class Brain:
    def __init__(self, hw, store):
        self.hw = hw
        self.store = store
        self.plan: dict | None = None
        self.decision: dict | None = None
        self._lock = threading.Lock()
        last = store.latest("plan")
        if last and last["mode"] == "ai":
            self.plan, self.decision = last["output"], last

    def history(self) -> list[dict]:
        """Last 7 days of totals. (Phase 4 swaps this for the Arkiv records.)"""
        return [
            {"day": d["day"], "panel_kwh": d["panel_wh"] / 1000, "flats_kwh": d["flats_wh"] / 1000, "solar_pct": d["solar_pct"]}
            for d in self.store.daily(7)
        ]

    def run_plan(self, which: str = "tomorrow") -> dict:
        with self._lock:
            forecast = forecast_day(which)
            away = {f: self.hw.away(f) for f in FLATS}
            plan, reply, prompt = planner.make_plan(forecast, self.history(), away)
            did = self.store.add_decision(
                "plan", "ai", plan["summary"], plan,
                request_id=reply.request_id, model=reply.model, tee=reply.tee, input=prompt,
            )
            self.plan = plan
            self.decision = self.store.latest("plan")
            log.info("plan #%s recorded (0G %s)", did, reply.request_id)
            return self.public()

    def public(self) -> dict:
        d = self.decision or {}
        return {
            "plan": self.plan,
            "mode": d.get("mode", "none"),
            "decision_id": d.get("id"),
            "request_id": d.get("request_id"),
            "model": d.get("model"),
            "tee": d.get("tee"),
            "storage_root": d.get("storage_root"),
            "ts": d.get("ts"),
        }
