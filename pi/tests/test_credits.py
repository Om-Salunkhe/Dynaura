"""Offline tests of the fair-share credits (pi/credits.py): no Pi, no network, no chain.

Run from pi/:  python tests/test_credits.py
"""
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import credits  # noqa: E402

P = {"export": 0.006, "import": 0.02, "neighbor": 0.013, "shop": 0.08}
TWO = {"A": 1.0, "B": 1.0, "C": 0.0}
THREE = {"A": 1.0, "B": 1.0, "C": 1.0}


def close(a, b, eps=1e-6):
    assert abs(a - b) < eps, (a, b)


def test_pawans_numbers_75_25_not_50_50():
    """The panel makes 100. A uses 20, B uses 40. A left 30 of its 50, B left 10: A gets 75%, B 25%."""
    row = {"available_wh": 100, "panel_wh": 60, "used": {"A": 20, "B": 40, "C": 0}}
    out = credits.settle_period([row], TWO, P, scale=1.0)
    a, b = out["flats"]["A"], out["flats"]["B"]
    assert (a["share_wh"], a["used_wh"], a["unused_wh"]) == (50, 20, 30)
    assert (b["share_wh"], b["used_wh"], b["unused_wh"]) == (50, 40, 10)
    assert out["spare_wh"] == 40 and out["pool"]["grid_wh"] == 40, "no 0G trade: the spare goes to the grid"
    r = out["pool"]["revenue_usdc"]
    close(r, 40 * 0.006)
    close(a["earned_usdc"], 0.75 * r)
    close(b["earned_usdc"], 0.25 * r)
    close(a["equal_split_usdc"], r / 2)
    close(b["equal_split_usdc"], r / 2)
    assert out["flats"]["C"]["equal_split_usdc"] == 0, "a flat with no share isn't in the equal split"


def test_neighbour_pays_for_sun_beyond_its_share():
    """Shares 30 each. A uses 10 (leaves 20), B uses 50 (takes 20 from A's spare), C uses 30."""
    row = {"available_wh": 90, "panel_wh": 90, "used": {"A": 10, "B": 50, "C": 30}}
    out = credits.settle_period([row], THREE, P, scale=1.0)
    a, b, c = (out["flats"][f] for f in "ABC")
    assert a["unused_wh"] == 20 and b["over_wh"] == 20 and c["unused_wh"] == 0
    assert out["pool"]["neighbor_wh"] == 20 and out["pool"]["grid_wh"] == 0
    close(out["pool"]["revenue_usdc"], 20 * 0.013)
    close(a["earned_usdc"], 20 * 0.013)
    close(b["owes_usdc"], 20 * 0.013)
    close(b["net_usdc"], -20 * 0.013)
    close(a["equal_split_usdc"], 20 * 0.013 / 3)


def test_pump_comes_off_the_top():
    """The panel drew 70 but the flats only 60: the pump used 10 before the shares are cut."""
    row = {"available_wh": 100, "panel_wh": 70, "used": {"A": 20, "B": 40, "C": 0}}
    out = credits.settle_period([row], TWO, P, scale=1.0)
    assert out["common_wh"] == 10
    assert out["flats"]["A"]["share_wh"] == 45 and out["flats"]["A"]["unused_wh"] == 25
    assert out["flats"]["B"]["unused_wh"] == 5


def test_ai_trade_sells_to_the_shop_no_ai_does_not():
    row = {"available_wh": 100, "panel_wh": 60, "used": {"A": 20, "B": 40, "C": 0}}
    ai = {"mode": "ai", "routes": [{"to": "shop", "wh": 25, "price": 0.08}, {"to": "grid", "wh": 15, "price": 0.006}]}
    out = credits.settle_period([row], TWO, P, [ai], scale=1.0)
    assert out["pool"]["shop_wh"] == 25 and out["pool"]["grid_wh"] == 15
    close(out["pool"]["revenue_usdc"], 25 * 0.08 + 15 * 0.006)
    no_ai = {"mode": "no-ai", "routes": [{"to": "shop", "wh": 25, "price": 0.08}]}
    out = credits.settle_period([row], TWO, P, [no_ai], scale=1.0)
    assert out["pool"]["shop_wh"] == 0 and out["pool"]["grid_wh"] == 40, "no 0G: nothing is routed to the shop"


def test_neighbour_price_from_0g_only_inside_the_band():
    row = {"available_wh": 90, "panel_wh": 90, "used": {"A": 10, "B": 50, "C": 30}}
    ok = {"mode": "ai", "routes": [{"to": "B", "wh": 20, "price": 0.015}]}
    out = credits.settle_period([row], THREE, P, [ok], scale=1.0)
    assert out["pool"]["prices"]["neighbor"] == 0.015
    bad = {"mode": "ai", "routes": [{"to": "B", "wh": 20, "price": 0.5}]}  # above the grid price
    out = credits.settle_period([row], THREE, P, [bad], scale=1.0)
    assert out["pool"]["prices"]["neighbor"] == 0.013, "outside export..import: ignored"


def test_estimate_below_what_was_drawn_never_invents_spare():
    row = {"available_wh": 10, "panel_wh": 60, "used": {"A": 20, "B": 40, "C": 0}}
    out = credits.settle_period([row], TWO, P, scale=1.0)
    assert out["available_wh"] == 60
    close(out["flats"]["B"]["over_wh"], 10)  # B took 10 of A's spare
    close(out["pool"]["neighbor_wh"], 10)
    assert out["pool"]["grid_wh"] == 0


def test_shares_config_and_scale():
    assert credits.parse_shares("A:2,B:1,C:0") == {"A": 2.0, "B": 1.0, "C": 0.0}
    assert credits.parse_shares("") == {"A": 1.0, "B": 1.0, "C": 1.0}
    row = {"available_wh": 1, "panel_wh": 0, "used": {}}
    out = credits.settle_period([row], THREE, P, scale=1.0)  # 1 model Wh = 1 real kWh
    close(out["pool"]["revenue_usdc"], 0.006)


class FakeStore:
    def __init__(self, rows, trades=()):
        self.rows, self.trade_rows = rows, list(trades)

    def summaries(self, meter=None, since=0, limit=1440):
        return [r for r in self.rows if r["meter"] == meter and r["minute"] >= since][:limit]

    def decisions(self, kind=None, limit=20):
        return [t for t in self.trade_rows if kind in (None, "trade")][:limit]


class FakeHw:
    def __init__(self, w):
        self.w = w

    def solar_available_w(self):
        return self.w


class FakeArc:
    def __init__(self):
        self.calls = []

    def post_credits(self, *a):
        self.calls.append(("post", a))
        return "0xpost"

    def fund_credits(self, *a):
        self.calls.append(("fund", a))
        return "0xfund"


class FakeArkiv:
    def __init__(self):
        self.posts = []

    def post(self, path, body):
        self.posts.append((path, body))


def test_ledger_end_to_end_with_store_settle_and_arkiv():
    day0 = int(time.mktime(time.strptime("2026-11-07", "%Y-%m-%d")))
    m = day0 + 12 * 3600
    rows = [{"minute": m, "meter": "panel", "wh": 0.06, "solar_wh": 0.06, "sig": "0x1"},
            {"minute": m, "meter": "A", "wh": 0.02, "solar_wh": 0.02, "sig": "0x2"},
            {"minute": m, "meter": "B", "wh": 0.04, "solar_wh": 0.04, "sig": "0x3"},
            {"minute": m, "meter": "C", "wh": 0.0, "solar_wh": 0.0, "sig": "0x4"}]
    trade = {"id": 9, "ts": m + 30, "mode": "ai", "request_id": "zg-trade-1", "summary": "A's spare to the shop",
             "output": {"routes": [{"to": "shop", "wh": 0.03, "price": 0.08}], "spare_wh": 0.04, "reason": "shop pays most"}}
    arkiv = FakeArkiv()
    led = credits.Ledger(FakeStore(rows, [trade]), FakeHw(6.0), arkiv, path=str(Path(tempfile.mkdtemp()) / "c.db"), shares="A:1,B:1,C:0")
    for i in range(12):  # 6 W for a minute = 0.1 Wh
        led.sample(5, now=m + i * 5)
    led.sample(5, now=m + 60)  # next minute closes this one
    p = led.period("2026-11-07", now=m)
    close(p["available_wh"], 0.1)
    close(p["flats"]["A"]["unused_wh"], 0.03)
    close(p["flats"]["B"]["unused_wh"], 0.01)
    assert p["pool"]["shop_wh"] == 0.03 and p["trades"][0]["request_id"] == "zg-trade-1"
    close(p["flats"]["A"]["earned_usdc"] / p["flats"]["B"]["earned_usdc"], 3.0)
    assert p["readings_hash"].startswith("0x") and p["chain"] is None
    arc = FakeArc()
    chain = led.settle(arc, "2026-11-07")
    post = arc.calls[0][1]
    assert post[1] == ["A", "B"] and post[2] == [30, 10] and post[3] == [0, 0], post  # real Wh
    assert post[4] == 13000, "USDC base units per real kWh"
    fund = arc.calls[1][1]
    assert fund[1] == int(round((0.03 * 0.08 + 0.01 * 0.006) * 1e6)), fund
    assert chain["post_tx"] == "0xpost" and led.period("2026-11-07", now=m)["chain"]["fund_tx"] == "0xfund"
    assert led.settle(arc, "2026-11-07")["post_tx"] == "0xpost" and len(arc.calls) == 2, "settled once"
    assert arkiv.posts[-1][0] == "/credit_period" and arkiv.posts[-1][1]["post_tx"] == "0xpost"
    assert led.post_new_trades() == 1 and led.post_new_trades() == 0, "each trade goes to Arkiv once"
    w = led.window(15, now=m + 120)
    assert w["needs"] == {} and w["spare_wh"] > 0


def test_real_board_available_sun_never_hammers_a_dead_forecast():
    import config
    calls = []

    class NoSim:
        pass

    led = credits.Ledger(FakeStore([]), NoSim(), path=str(Path(tempfile.mkdtemp()) / "c.db"))
    assert led.available_w() is None, "no PANEL_BEST_W: unknown, so no spare is made up"
    old = getattr(config, "PANEL_BEST_W", 0)
    config.PANEL_BEST_W = 3.0
    import forecast
    real = forecast.forecast_day
    forecast.forecast_day = lambda which: calls.append(which) or (_ for _ in ()).throw(OSError("offline"))
    try:
        assert led.available_w() is None and led.available_w() is None
        assert len(calls) == 1, "one failed fetch, then a 5-minute pause"
    finally:
        forecast.forecast_day = real
        config.PANEL_BEST_W = old


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"ok  {t.__name__}")
    print(f"{len(tests)} passed")
