"""spare.py: 0G runs the tank pump on spare sun when flats are away (demo scenario 2).

Run: cd pi && python tests/test_spare_pump.py
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config  # noqa: E402
import spare  # noqa: E402
import zg  # noqa: E402


def ok(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print("  ok ", msg)


class FakeHW:
    def __init__(self):
        self.pump_runs = []
        self._until = 0

    def run_pump(self, s):
        self.pump_runs.append(s)
        self._until = time.monotonic() + s

    def pump_on(self):
        return time.monotonic() < self._until


class FakeStore:
    def __init__(self):
        self.rows = []

    def add_decision(self, kind, mode, summary, output, **kw):
        self.rows.append({"kind": kind, "mode": mode, "summary": summary, "output": output, **kw})
        return len(self.rows)


class FakeLoop:
    def __init__(self, state):
        self.state = state
        self.stopped_safe = False


def state(panel_w, away=("B", "C"), flat_w=0.05):
    return {"meters": {"panel": {"w": panel_w}, **{f: {"w": flat_w} for f in "ABC"}},
            "flats": {f: {"source": "grid", "away": f in away} for f in "ABC"}}


def reply(text):
    return zg.ZGReply(text=text, request_id="req-123", model="0gm-1.0", trace={"tee_verified": True})


config.PUMP_SECONDS = 8
config.SPARE_PUMP_MIN_W = 0.3
config.SPARE_PUMP = True
config.SPARE_PUMP_COOLDOWN_S = 180

snap = spare.spare_snapshot(state(1.0))
ok(snap["away"] == ["B", "C"] and snap["home"] == ["A"], "away / home flats from the live state")
ok(abs(snap["spare_w"] - 0.95) < 1e-9, "spare = panel - what home flats draw")
class SunHW:
    def solar_available_w(self):
        return 1.2


ok(abs(spare.spare_snapshot(state(0.0), SunHW())["spare_w"] - 1.15) < 1e-9,
   "a board that knows the available sun (SIM, real panel load) is used over the panel meter")
p = spare.build_prompt(snap, None)
ok("Flats away: B, C" in p and "0.95 W" in p, "prompt names who is away and the spare power")

# 0G says run: the pump runs, the decision is recorded with the request ID
spare.zg.chat_maybe_thinking = lambda *a, **k: reply('{"run_pump": true, "seconds": 20, "reason": "B and C are away, use the sun"}')
hw, store = FakeHW(), FakeStore()
d = spare.decide_pump(state(1.0), hw=hw, store=store)
ok(d["mode"] == "ai" and d["run_pump"] and hw.pump_runs == [8], "0G yes + real spare -> pump runs (capped at PUMP_SECONDS)")
ok(store.rows[-1]["kind"] == "pump" and store.rows[-1]["request_id"] == "req-123", "recorded as a 'pump' decision with the 0G request ID")

# 0G says run but there is no spare: the Pi refuses
hw, store = FakeHW(), FakeStore()
d = spare.decide_pump(state(0.1), hw=hw, store=store)
ok(not d["run_pump"] and hw.pump_runs == [] and d["notes"], "0G yes but no spare -> Pi refuses, pump off")

# 0G says no
spare.zg.chat_maybe_thinking = lambda *a, **k: reply('{"run_pump": false, "seconds": 0, "reason": "tank just filled"}')
hw, store = FakeHW(), FakeStore()
d = spare.decide_pump(state(1.0), hw=hw, store=store)
ok(not d["run_pump"] and hw.pump_runs == [] and d["mode"] == "ai", "0G no -> pump off, still an AI decision")


# 0G down: nothing faked
def down(*a, **k):
    raise zg.ZGUnavailable("0G call failed: Connection error")


spare.zg.chat_maybe_thinking = down
hw, store = FakeHW(), FakeStore()
d = spare.decide_pump(state(1.0), hw=hw, store=store)
ok(d["mode"] == "no-ai" and not d["run_pump"] and hw.pump_runs == [], "0G down -> no-ai, pump stays off")
ok(store.rows[-1]["mode"] == "no-ai" and store.rows[-1]["kind"] == "pump", "the no-ai decision is logged too")

# SparePump.maybe: only asks when someone is away, sun is spare, and not within the cooldown
calls = []
spare.zg.chat_maybe_thinking = lambda *a, **k: (calls.append(1), reply('{"run_pump": true, "seconds": 5, "reason": "x"}'))[1]
hw = FakeHW()
sp = spare.SparePump(hw, FakeLoop(state(1.0, away=())), store=FakeStore())
sp.maybe(in_window=True, sun_ok=True)
time.sleep(0.2)
ok(calls == [], "nobody away -> no 0G call")
sp.loop.state = state(1.0)
sp.maybe(in_window=False, sun_ok=True)
time.sleep(0.2)
ok(calls == [], "outside the solar window -> no 0G call")
sp.maybe(in_window=True, sun_ok=True)
time.sleep(0.3)
ok(calls == [1] and hw.pump_runs == [5], "B and C away + spare sun -> 0G asked, pump runs")
hw._until = 0
sp.maybe(in_window=True, sun_ok=True)
time.sleep(0.2)
ok(calls == [1], "cooldown: no second ask straight away")
d = sp.check_now()
ok(calls == [1, 1] and d["run_pump"], "check_now (demo button) asks right away")
ok(sp.status()["last"]["request_id"] == "req-123", "status carries the last decision")
ok(abs(sp.status()["now"]["spare_w"] - 0.95) < 1e-9, "status carries the spare power right now")

print("spare pump: all checks passed")
