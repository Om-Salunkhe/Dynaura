"""Tests for 0G selling the spare sun (pi/trader.py) and the planner's spare_plan (pi/planner.py).

The 0G Router is mocked over real HTTP (OpenAI chat API with the ZG-Res-Key header and x_0g_trace),
so zg.chat runs unchanged. No network, no keys.

Run from pi/:  python tests/test_trader.py
"""
import json
import socket
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config  # noqa: E402
import planner  # noqa: E402
import trader  # noqa: E402
import zg  # noqa: E402
from store import Store  # noqa: E402

ROUTER = {"answer": "", "tee": True, "seen": []}


class FakeRouter(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers["content-length"])))
        ROUTER["seen"].append(req)
        assert req.get("verify_tee") is True
        assert req["max_tokens"] >= 3000, "0G gets room to reason"
        n = len(ROUTER["seen"])
        out = json.dumps({
            "id": f"chatcmpl-{n}", "object": "chat.completion", "created": 1, "model": req["model"],
            "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": ROUTER["answer"]}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
            "x_0g_trace": {"request_id": f"router-{n}", "provider": "0xprovider", "tee_verified": ROUTER["tee"]},
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("ZG-Res-Key", f"zg-trade-{n}")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)


class FakeUploader:
    def __init__(self):
        self.episodes = []

    def enqueue(self, did, extra=None):
        self.episodes.append((did, extra or {}))


def answer(routes, price=0.013, reason="B used more than its share; the shop takes the rest."):
    ROUTER["answer"] = "<think>sell</think>" + json.dumps({"routes": routes, "neighbor_price": price, "reason": reason})


def point_router(url):
    config.ZG_ROUTER_URL, config.ZG_API_KEY = url, "sk-test"
    zg._client = None


def closed_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def total(routes):
    return round(sum(r["wh"] for r in routes), 3)


def by(routes):
    return {r["to"]: (r["wh"], r["price"]) for r in routes}


def test_trader(tmp):
    srv = HTTPServer(("127.0.0.1", 0), FakeRouter)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    point_router(f"http://127.0.0.1:{srv.server_port}/v1")
    config.GRID_RATE_USDC, config.SHOP_PRICE_USDC = 0.02, 0.08
    trader.EXPORT_RATE_USDC, trader.NEIGHBOR_RATE_USDC = 0.006, None
    px = trader.prices()
    assert px == {"export": 0.006, "import": 0.02, "shop": 0.08, "neighbor": 0.013}, px

    store, up, notified = Store(str(tmp / "t.db")), FakeUploader(), []
    kw = {"store": store, "uploader": up, "notify": notified.append, "window": ["12:00", "12:15"]}

    # 1. A light, B heavy: 40 Wh spare, B used 10 over its share, the shop orders 20.
    answer([{"to": "B", "wh": 10}, {"to": "shop", "wh": 20}, {"to": "grid", "wh": 10}])
    r = trader.decide_routes(40, {"A": 0, "B": 10, "C": 0}, 20, **kw)
    assert r["mode"] == "ai" and r["request_id"] == "zg-trade-1" and r["tee"] is True, r
    assert by(r["routes"]) == {"B": (10, 0.013), "shop": (20, 0.08), "grid": (10, 0.006)}, r["routes"]
    d = store.decision(r["decision_id"])
    assert (d["kind"], d["mode"], d["request_id"]) == ("trade", "ai", "zg-trade-1"), d
    assert d["output"]["routes"] == r["routes"] and d["output"]["window"] == ["12:00", "12:15"]
    assert up.episodes[-1][0] == d["id"] and up.episodes[-1][1]["raw_answer"].startswith("<think>")
    assert notified == [d["id"]]
    assert "Flat B used 10 Wh over its share" in ROUTER["seen"][-1]["messages"][-1]["content"]

    # 2. 0G over-routes: the Pi caps every buyer, drops flats that don't need more, clamps the price,
    #    and whatever is left goes to the grid. Routes always add up to the spare exactly.
    answer([{"to": "Flat B", "wh": 25}, {"to": "C", "wh": 5}, {"to": "shop", "wh": 50},
            {"to": "moon", "wh": 3}], price=0.5)
    r = trader.decide_routes(40, {"B": 10}, 20, **kw)
    assert by(r["routes"]) == {"B": (10, 0.02), "shop": (20, 0.08), "grid": (10, 0.006)}, r["routes"]
    assert total(r["routes"]) == 40 and r["neighbor_price"] == 0.02
    notes = " | ".join(r["notes"])
    assert "outside" in notes and "C" in notes and "moon" in notes and "B: 25 Wh asked, 10 Wh allowed" in notes, notes

    # 3. More demand than spare: 0G's order of preference is kept, never more than the spare.
    answer([{"to": "shop", "wh": 20}, {"to": "B", "wh": 10}])
    r = trader.decide_routes(12, {"B": 10}, 20, **kw)
    assert by(r["routes"]) == {"shop": (12, 0.08)} and total(r["routes"]) == 12, r["routes"]

    # 4. No routes in the answer: no AI trade, the spare goes to the grid, the 0G call is kept on record.
    ROUTER["answer"] = "I would sell it to the neighbours, probably."
    n = len(store.decisions("trade", 100))
    r = trader.decide_routes(40, {"B": 10}, 20, **kw)
    assert r["mode"] == "no-ai" and r["routes"] == [{"to": "grid", "wh": 40, "price": 0.006}], r
    d = store.decision(r["decision_id"])
    assert (d["kind"], d["mode"]) == ("trade", "no-ai") and d["output"]["zg_request_id"], d
    assert len(store.decisions("trade", 100)) == n + 1

    # 5. TEE signature did not verify: refused like 0G being down.
    answer([{"to": "B", "wh": 10}])
    ROUTER["tee"] = False
    r = trader.decide_routes(40, {"B": 10}, 20, **kw)
    assert r["mode"] == "no-ai" and by(r["routes"]) == {"grid": (40, 0.006)}, r
    ROUTER["tee"] = True

    # 6. Nothing to sell: no 0G call, nothing recorded.
    calls, n = len(ROUTER["seen"]), len(store.decisions("trade", 100))
    r = trader.decide_routes(0, {"B": 10}, 20, **kw)
    assert r["mode"] == "none" and r["routes"] == [] and len(ROUTER["seen"]) == calls
    assert len(store.decisions("trade", 100)) == n

    # 7. Without store=: 0G's routing returned, nothing recorded or uploaded.
    answer([{"to": "B", "wh": 10}])
    eps = len(up.episodes)
    r = trader.decide_routes(40, {"B": 10}, 0)
    assert r["mode"] == "ai" and r["decision_id"] is None and by(r["routes"]) == {"B": (10, 0.013), "grid": (30, 0.006)}
    assert len(store.decisions("trade", 100)) == n and len(up.episodes) == eps

    # 8. The shared API's trades list.
    t = trader.trades(store)
    assert t[0]["mode"] == "no-ai" and t[-1]["mode"] == "ai" and t[-1]["request_id"] == "zg-trade-1", t
    assert set(t[0]) >= {"at", "window", "routes", "request_id", "mode", "reason", "decision_id", "storage_root"}

    # 9. The loop: trades when there is spare, skips when there isn't.
    snap = {"spare_wh": 30, "needs": {"B": 5}, "shop_order_wh": 0, "window": ["13:00", "13:15"]}
    loop = trader.TradeLoop(lambda: snap, store=store, uploader=up, speed=60)
    assert loop.interval_s == trader.TRADE_MIN_GAP_S  # sim: never more than one 0G call a minute
    answer([{"to": "B", "wh": 5}])
    r = loop.run_now()
    assert r["mode"] == "ai" and by(r["routes"]) == {"B": (5, 0.013), "grid": (25, 0.006)}, r
    snap["spare_wh"] = 0.2
    assert "skipped" in loop.run_now()
    assert trader.TradeLoop(lambda: None).run_now()["skipped"]

    # 10. 0G unreachable: the whole spare to the grid at feed-in, recorded as no-ai, nothing invented.
    point_router(f"http://127.0.0.1:{closed_port()}/v1")
    r = trader.decide_routes(40, {"B": 10}, 20, **kw)
    assert r["mode"] == "no-ai" and r["request_id"] is None and r["routes"] == [{"to": "grid", "wh": 40, "price": 0.006}]
    d = store.decision(r["decision_id"])
    assert d["mode"] == "no-ai" and d["request_id"] is None and "unreachable" in d["output"]["reason"], d
    assert up.episodes[-1][0] == d["id"]  # anchored like any other decision
    srv.shutdown()


def test_planner_spare():
    forecast = {"date": "2026-11-08", "strength": "strong", "sun_hours": 5.1, "building_kwh": 6.0,
                "hours": [{"hour": 12, "radiation": 800, "cloud": 5}]}
    history = [{"day": "2026-11-06", "panel_kwh": 5.0, "flats_kwh": 2.0, "solar_pct": 60}]
    plan = {"summary": "s", "solar_window": ["10:00", "15:00"], "jobs": [{"id": "tank", "start": "11:00", "minutes": 60}],
            "recommendations": {}, "split_kwh": {"flats": 3, "common": 2, "buffer": 1}, "shop_offer_kwh": 1,
            "spare_plan": {"neighbors_kwh": 0.5, "shop_kwh": "1.2", "grid_kwh": -3, "why": "B is heavy at noon"}}

    config.CREDITS_ENABLED = True
    assert '"spare_plan"' in planner.system_prompt() and planner.system_prompt().rstrip().endswith("}")
    assert "Spare sun forecast" in planner.build_prompt(forecast, history, {"A": False})
    v = planner.validate(plan, forecast)
    assert v["spare_plan"] == {"neighbors_kwh": 0.5, "shop_kwh": 1.2, "grid_kwh": 0.0, "why": "B is heavy at noon"}, v
    assert v["shop_offer_kwh"] == 1  # the existing keys are unchanged
    assert planner.validate({**plan, "spare_plan": None}, forecast)["spare_plan"] is None

    config.CREDITS_ENABLED = False  # off: the plan is exactly as before
    assert planner.system_prompt() == planner.SYSTEM
    assert "Spare sun" not in planner.build_prompt(forecast, history, {"A": False})
    assert "spare_plan" not in planner.validate(plan, forecast)


def main():
    test_trader(Path(tempfile.mkdtemp(prefix="dynaura-trade-")))
    test_planner_spare()
    print("trader + planner spare_plan: all checks passed", flush=True)


if __name__ == "__main__":
    main()
