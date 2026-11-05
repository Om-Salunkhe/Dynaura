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
    def __init__(self, hw, store, uploader=None):
        self.hw = hw
        self.store = store
        self.uploader = uploader
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
        """Ask 0G for a plan. If 0G (or the forecast) fails, go to no-AI mode:
        no decision is faked, every flat stays on grid, the pump stays off, and it is logged."""
        with self._lock:
            try:
                forecast = forecast_day(which)
                away = {f: self.hw.away(f) for f in FLATS}
                plan, reply, prompt = planner.make_plan(forecast, self.history(), away)
            except Exception as e:
                return self._no_ai(str(e))
            did = self.store.add_decision(
                "plan", "ai", plan["summary"], plan,
                request_id=reply.request_id, model=reply.model, tee=reply.tee, input=prompt,
            )
            if self.uploader:
                self.uploader.enqueue(did, {"forecast": forecast, "raw_answer": reply.text})
            self.plan = plan
            self.decision = self.store.latest("plan")
            log.info("plan #%s recorded (0G %s)", did, reply.request_id)
            return self.public()

    def _no_ai(self, reason: str) -> dict:
        log.warning("NO-AI MODE: %s", reason)
        self.hw.safe_stop()
        did = self.store.add_decision("plan", "no-ai", "0G unreachable: building runs on grid, no jobs moved",
                                      {"reason": reason[:300]})
        self.plan = None
        self.decision = self.store.latest("plan")
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
            "reason": (d.get("output") or {}).get("reason") if d.get("mode") == "no-ai" else None,
        }
