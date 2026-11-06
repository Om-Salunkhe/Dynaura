"""The daily plan asks 0G without thinking (PLAN_THINKING=false), and a second plan request while one is
being made is refused (POST /api/plan/run -> 409) instead of queueing behind it.

The 0G Router is mocked over real HTTP. No network, no keys.

Run from pi/:  python tests/test_plan_fast.py
"""
import json
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config  # noqa: E402
import planner  # noqa: E402
import zg  # noqa: E402
from brain import Brain, PlanBusy  # noqa: E402
from store import Store  # noqa: E402

SEEN = []
PLAN = {"summary": "Tank and RO in the noon sun.", "solar_window": ["10:00", "15:00"],
        "jobs": [{"id": "tank", "start": "11:00", "minutes": 60, "why": "strong sun"}],
        "recommendations": {"A": [{"title": "Run the washer at noon", "why": "sun", "icon": "washer"}], "B": [], "C": []},
        "split_kwh": {"flats": 3, "common": 2, "buffer": 1}, "shop_offer_kwh": 0.5,
        "spare_plan": {"neighbors_kwh": 0.4, "shop_kwh": 0.5, "grid_kwh": 0.3, "why": "B is heavy at noon"}}


class FakeRouter(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers["content-length"])))
        SEEN.append(req)
        out = json.dumps({
            "id": "chatcmpl-1", "object": "chat.completion", "created": 1, "model": req["model"],
            "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": json.dumps(PLAN)}}],
            "x_0g_trace": {"request_id": "r", "provider": "0xp"},
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("ZG-Res-Key", f"zg-plan-{len(SEEN)}")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)


def main():
    srv = HTTPServer(("127.0.0.1", 0), FakeRouter)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    config.ZG_ROUTER_URL, config.ZG_API_KEY = f"http://127.0.0.1:{srv.server_port}/v1", "sk-test"
    zg._client = None
    config.CREDITS_ENABLED = True
    forecast = {"date": "2026-11-08", "strength": "strong", "sun_hours": 5.1, "building_kwh": 6.0,
                "hours": [{"hour": 12, "radiation": 800, "cloud": 5}]}

    # 1. Default: the plan is asked without thinking, and the answer is validated as before
    assert config.PLAN_THINKING is False
    plan, reply, _ = planner.make_plan(forecast, [], {"A": False, "B": False, "C": False})
    assert SEEN[-1]["chat_template_kwargs"] == {"enable_thinking": False} and SEEN[-1]["max_tokens"] >= 3000
    assert SEEN[-1]["verify_tee"] is True
    assert plan["jobs"][0]["id"] == "tank" and plan["solar_window"] == ["10:00", "15:00"], plan
    assert plan["spare_plan"]["shop_kwh"] == 0.5 and reply.request_id == "zg-plan-1"

    # 2. PLAN_THINKING=true: asked as before, with thinking
    config.PLAN_THINKING = True
    planner.make_plan(forecast, [], {"A": False, "B": False, "C": False})
    assert "chat_template_kwargs" not in SEEN[-1]
    config.PLAN_THINKING = False

    # 3. A plan is already being made: a second request is refused at once, not queued
    brain = Brain(None, Store(str(Path(tempfile.mkdtemp()) / "t.db")))
    assert brain.public()["planning"] is False
    brain._lock.acquire()  # stands in for the start-up plan waiting on 0G
    try:
        assert brain.public()["planning"] is True
        try:
            brain.run_plan("today", wait=False)
            raise AssertionError("a second plan started while one was running")
        except PlanBusy:
            pass
    finally:
        brain._lock.release()
    assert brain.public()["planning"] is False

    srv.shutdown()
    print("plan without thinking + busy guard: all checks passed", flush=True)


if __name__ == "__main__":
    main()
