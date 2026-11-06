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

ROUTER = {"answer": "", "tee": True, "seen": [], "reject_no_think": False}


class FakeRouter(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers["content-length"])))
        ROUTER["seen"].append(req)
        assert req.get("verify_tee") is True
        assert req["max_tokens"] >= 3000, "0G gets room to reason"
        no_think = (req.get("chat_template_kwargs") or {}).get("enable_thinking") is False
        if no_think and ROUTER["reject_no_think"]:
            out = json.dumps({"error": {"message": "unknown field chat_template_kwargs", "type": "invalid_request"}}).encode()
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)
            return
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
    body = {"routes": routes, "reason": reason, **({"neighbor_price": price} if price is not None else {})}
    ROUTER["answer"] = "<think>sell</think>" + json.dumps(body)


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
    assert ROUTER["seen"][-1]["chat_template_kwargs"] == {"enable_thinking": False}  # trades: thinking off

    # 1b. A Router that refuses the option: asked again with thinking, still an AI trade
    ROUTER["reject_no_think"] = True
    calls = len(ROUTER["seen"])
    r = trader.decide_routes(40, {"B": 10}, 20, **kw)
    assert r["mode"] == "ai" and len(ROUTER["seen"]) == calls + 2, r
    assert "chat_template_kwargs" not in ROUTER["seen"][-1]
    ROUTER["reject_no_think"] = False

    # 2. Neighbours first, by rule: 0G's own flat routes don't change that. 0G's shop amount is capped
    #    at the order and the rest of the pool; its price is clamped into the band; the grid gets the rest.
    answer([{"to": "Flat B", "wh": 25}, {"to": "C", "wh": 5}, {"to": "shop", "wh": 50},
            {"to": "moon", "wh": 3}], price=0.5)
    r = trader.decide_routes(40, {"B": 10}, 20, **kw)
    assert by(r["routes"]) == {"B": (10, 0.02), "shop": (20, 0.08), "grid": (10, 0.006)}, r["routes"]
    assert total(r["routes"]) == 40 and r["neighbor_price"] == 0.02
    notes = " | ".join(r["notes"])
    assert "outside" in notes and "shop: 50 Wh asked, 20 Wh allowed" in notes, notes

    # 3. Demand > spare (12 spare, B 10 over, shop wants 20): B 10 first, the shop gets the 2 left.
    #    0G's preference for the shop can't take B's sun: B already drew it.
    ROUTER["answer"] = json.dumps({"neighbor_price": 0.019, "shop_wh": 12, "reason": "Spare is scarce."})
    r = trader.decide_routes(12, {"B": 10}, 20, **kw)
    assert by(r["routes"]) == {"B": (10, 0.019), "shop": (2, 0.08)} and total(r["routes"]) == 12, r["routes"]
    assert "Neighbours served first: Flat B used 10 Wh over its share; 10 Wh of the pool (83%)" in \
        ROUTER["seen"][-1]["messages"][-1]["content"]

    # 3b. Two neighbours need more than the spare: shared pro rata, nothing for the shop or the grid.
    ROUTER["answer"] = json.dumps({"neighbor_price": 0.02, "shop_wh": 5, "reason": "All to neighbours."})
    r = trader.decide_routes(9, {"B": 10, "C": 5}, 20, **kw)
    assert by(r["routes"]) == {"B": (6, 0.02), "C": (3, 0.02)}, r["routes"]
    assert "pro rata" in " | ".join(r["notes"])

    # 3c. The answer format the prompt asks for; no shop amount -> the rest to the grid (nothing invented)
    ROUTER["answer"] = json.dumps({"neighbor_price": 0.009, "reason": "Plenty of spare."})
    r = trader.decide_routes(40, {"B": 5}, 20, **kw)
    assert by(r["routes"]) == {"B": (5, 0.009), "grid": (35, 0.006)}, r["routes"]
    ROUTER["answer"] = json.dumps({"reason": "no idea"})
    assert trader.decide_routes(40, {"B": 5}, 20, **kw)["mode"] == "no-ai"

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

    # 9b. credits.py's window() as it is: since/until (unix), prices.neighbor_default, unused
    ledger = {"since": 1794380400, "until": 1794381300, "spare_wh": 20, "needs": {"A": 0, "B": 8, "C": 0},
              "unused": {"A": 15, "B": 0, "C": 5},
              "prices": {"export": 0.006, "import": 0.02, "neighbor_default": 0.011, "shop": 0.08}}
    answer([{"to": "B", "wh": 8}], price=None)
    r = trader.TradeLoop(lambda: ledger, store=store, uploader=up).run_now()
    assert r["mode"] == "ai" and r["window"] == [1794380400, 1794381300], r
    assert by(r["routes"]) == {"B": (8, 0.011), "grid": (12, 0.006)}, r["routes"]  # no price from 0G: ledger default
    d = store.decision(r["decision_id"])
    assert d["output"]["window"] == [1794380400, 1794381300] and d["output"]["spare_wh"] == 20
    assert "Window " in ROUTER["seen"][-1]["messages"][-1]["content"] and ":" in ROUTER["seen"][-1]["messages"][-1]["content"]
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
