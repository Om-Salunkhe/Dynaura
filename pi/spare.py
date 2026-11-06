"""0G runs a shared job on spare sun (demo scenario 2).

When flats are away at noon, their share of the panel is wasted. The Pi asks 0G whether the shared
tank pump should run now on that spare sun:

    decide_pump(state, *, store=, uploader=, notify=) -> dict

The Pi checks 0G's answer: the pump only runs when the panel really has spare power
(panel W - what the home flats draw >= SPARE_PUMP_MIN_W) and for at most PUMP_SECONDS. The decision is
recorded as kind "pump" with its episode on 0G Storage and EpisodeRegistry, like every other decision.

No 0G (down, TEE check failed, no usable answer): the pump does not run. Nothing is faked; the
decision is logged as mode "no-ai".
"""
import logging
import threading
import time
from datetime import datetime

import config
import zg

log = logging.getLogger("dynaura.spare")

FLATS = ("A", "B", "C")

SYSTEM = """You are Dyna, the energy planner for a small apartment building (flats A, B, C) with a shared rooftop
solar panel and a shared overhead water tank. The tank pump is a flexible job: it can run whenever the sun allows.
When flats are away, their share of the sun is wasted unless a shared job uses it.
Decide whether the tank pump should run RIGHT NOW on the spare sun.
Run it when there is spare solar power that would otherwise be wasted and the tank has not just been filled.
Do not run it when there is no spare power.
Answer with ONE JSON object only, no other text:
{"run_pump": true|false, "seconds": <number>, "reason": "one short sentence for the residents"}"""


def spare_snapshot(state: dict, hw=None) -> dict:
    """What 0G needs from the live state: the sun the panel can give, what home flats draw, who is away.

    The panel meter only reads what is drawn from it in SIM, so a board that knows the available sun
    (hw.solar_available_w: SIM's sun model, or the real panel's own load) is asked first."""
    meters = state.get("meters") or {}
    flats = state.get("flats") or {}
    panel_w = float((meters.get("panel") or {}).get("w") or 0.0)
    if hw is not None and hasattr(hw, "solar_available_w"):
        try:
            avail = hw.solar_available_w()
        except Exception:
            avail = None
        if avail is not None:
            panel_w = float(avail)
    away = [f for f in FLATS if (flats.get(f) or {}).get("away")]
    home_w = sum(float((meters.get(f) or {}).get("w") or 0.0) for f in FLATS if f not in away)
    return {"panel_w": round(panel_w, 4), "home_w": round(home_w, 4), "spare_w": round(max(0.0, panel_w - home_w), 4),
            "away": away, "home": [f for f in FLATS if f not in away]}


def build_prompt(snap: dict, last_run_ago_s: float | None) -> str:
    ago = "never today" if last_run_ago_s is None else f"{round(last_run_ago_s / 60, 1)} minutes ago"
    return (f"Time now: {datetime.now().strftime('%H:%M')}.\n"
            f"Panel output now: {snap['panel_w']} W (model scale).\n"
            f"Flats at home: {', '.join(snap['home']) or 'none'}, drawing {snap['home_w']} W.\n"
            f"Flats away: {', '.join(snap['away']) or 'none'}.\n"
            f"Spare solar power now: {snap['spare_w']} W.\n"
            f"Tank pump last ran: {ago}. One run fills the tank in up to {int(config.PUMP_SECONDS)} seconds.\n"
            "Should the tank pump run now?")


def validate(answer: dict, snap: dict) -> tuple[bool, float, list[str]]:
    """(run, seconds, notes). The Pi never runs the pump without real spare power."""
    notes = []
    run = answer.get("run_pump") is True
    try:
        seconds = float(answer.get("seconds") or config.PUMP_SECONDS)
    except (TypeError, ValueError):
        seconds = config.PUMP_SECONDS
    seconds = max(1.0, min(seconds, config.PUMP_SECONDS))
    if run and snap["spare_w"] < config.SPARE_PUMP_MIN_W:
        notes.append(f"Pi refused: spare {snap['spare_w']} W is below {config.SPARE_PUMP_MIN_W} W")
        run = False
    return run, seconds, notes


def decide_pump(state: dict, *, hw=None, store=None, uploader=None, notify=None,
                last_run_ago_s: float | None = None) -> dict:
    """Ask 0G, check the answer, run the pump if both agree. Never raises."""
    snap = spare_snapshot(state, hw)
    prompt = build_prompt(snap, last_run_ago_s)
    reply = None
    try:
        messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}]
        reply = zg.chat_maybe_thinking(messages, False, max_tokens=800, temperature=0.2)
        answer = zg.extract_json(reply.text)
        run, seconds, notes = validate(answer, snap)
    except zg.ZGUnavailable as e:
        out = {**snap, "run_pump": False, "reason": "0G unreachable: the pump stays off (no AI, nothing faked)",
               "zg_error": str(e)[:300]}
        did = store.add_decision("pump", "no-ai", "0G unreachable: pump stays off", out, input=prompt) if store else None
        _publish(did, uploader, notify, {"raw_answer": reply.text} if reply else None)
        log.warning("spare pump: no 0G (decision #%s): %s", did, e)
        return {**out, "mode": "no-ai", "decision_id": did, "request_id": None, "at": time.time()}

    reason = str(answer.get("reason") or "")[:240]
    if run and hw is not None:
        hw.run_pump(seconds)
    summary = (f"Pump on for {int(seconds)} s on {snap['spare_w']} W of spare sun ({', '.join(snap['away'])} away)"
               if run else f"Pump stays off: {reason or 'no spare sun'}")
    out = {**snap, "run_pump": run, "seconds": seconds if run else 0, "reason": reason, "notes": notes}
    did = None
    if store is not None:
        did = store.add_decision("pump", "ai", summary, out, request_id=reply.request_id,
                                 model=reply.model, tee=reply.tee, input=prompt)
    _publish(did, uploader, notify, {"raw_answer": reply.text})
    log.info("spare pump #%s (0G %s): %s", did, reply.request_id, summary)
    return {**out, "mode": "ai", "decision_id": did, "request_id": reply.request_id, "model": reply.model,
            "tee": reply.tee_verified, "summary": summary, "at": time.time()}


def _publish(did, uploader, notify, extra) -> None:
    if did is None:
        return
    if uploader:
        uploader.enqueue(did, extra)
    if notify:
        try:
            notify(did)
        except Exception:
            log.exception("decision callback failed")


class SparePump:
    """Watches the live state; when a flat is away and the sun is spare, asks 0G (at most once per
    SPARE_PUMP_COOLDOWN_S). check_now() asks right away (the demo button)."""

    def __init__(self, hw, loop, *, store=None, uploader=None, notify=None):
        self.hw, self.loop = hw, loop
        self.store, self.uploader, self.notify = store, uploader, notify
        self.last: dict | None = None
        self.last_ask = 0.0
        self.last_run: float | None = None
        self._lock = threading.Lock()

    def check_now(self) -> dict:
        if not self._lock.acquire(blocking=False):
            return {"skipped": "0G is already deciding"}
        try:
            self.last_ask = time.time()
            ago = None if self.last_run is None else time.time() - self.last_run
            d = decide_pump(self.loop.state, hw=self.hw, store=self.store, uploader=self.uploader,
                            notify=self.notify, last_run_ago_s=ago)
            if d.get("run_pump"):
                self.last_run = time.time()
            self.last = d
            return d
        finally:
            self._lock.release()

    def maybe(self, *, in_window: bool, sun_ok: bool) -> None:
        """Called by the job runner every step. Starts a background 0G check when it is worth one."""
        if not config.SPARE_PUMP or not (in_window and sun_ok) or self.loop.stopped_safe or self.hw.pump_on():
            return
        if time.time() - self.last_ask < config.SPARE_PUMP_COOLDOWN_S:
            return
        snap = spare_snapshot(self.loop.state, self.hw)
        if not snap["away"] or snap["spare_w"] < config.SPARE_PUMP_MIN_W:
            return
        self.last_ask = time.time()
        threading.Thread(target=self.check_now, name="spare-pump", daemon=True).start()

    def status(self) -> dict:
        try:
            now = spare_snapshot(self.loop.state, self.hw)
        except Exception:
            now = None
        return {"enabled": config.SPARE_PUMP, "last": self.last, "deciding": self._lock.locked(), "now": now,
                "cooldown_s": config.SPARE_PUMP_COOLDOWN_S, "min_spare_w": config.SPARE_PUMP_MIN_W}
