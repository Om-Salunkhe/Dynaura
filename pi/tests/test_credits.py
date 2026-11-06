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


def test_demo_story_three_flats_75_25_0():
    """DECISIONS: 150 available -> shares 50 each. A uses 20, B 40, C 50 -> unused 30 / 10 / 0,
    earned 75% / 25% / 0, while an equal split pays R/3 each."""
    row = {"available_wh": 150, "panel_wh": 110, "used": {"A": 20, "B": 40, "C": 50}}
    out = credits.settle_period([row], THREE, P, scale=1.0)
    a, b, c = (out["flats"][f] for f in "ABC")
    assert [x["share_wh"] for x in (a, b, c)] == [50, 50, 50]
    assert [x["unused_wh"] for x in (a, b, c)] == [30, 10, 0] and c["over_wh"] == 0
    r = out["pool"]["revenue_usdc"]
    close(a["earned_usdc"], 0.75 * r)
    close(b["earned_usdc"], 0.25 * r)
    assert c["earned_usdc"] == 0
    for x in (a, b, c):
        close(x["equal_split_usdc"], r / 3)


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


def test_no_ai_rule_neighbours_first_at_midpoint_no_shop_rest_to_grid():
    """0G down (approved rule): neighbours' over-use is still settled first at the midpoint, a fixed
    rule; nothing goes to the shop; the rest goes to the grid. The trade is dy-0g's no-ai output."""
    row = {"available_wh": 90, "panel_wh": 75, "used": {"A": 5, "B": 45, "C": 25}}  # shares 30: B over 15
    no_ai = {"mode": "no-ai", "request_id": None, "reason": "fixed rule: drawn energy settled at the midpoint; no AI pricing",
             "routes": [{"to": "B", "wh": 15, "price": 0.013}, {"to": "shop", "wh": 5, "price": 0.08}, {"to": "grid", "wh": 15, "price": 0.006}]}
    out = credits.settle_period([row], THREE, P, [no_ai], scale=1.0)
    pool = out["pool"]
    assert pool["neighbor_wh"] == 15 and pool["prices"]["neighbor"] == 0.013, "neighbours first, at the midpoint"
    assert pool["shop_wh"] == 0, "no shop sale without 0G, whatever a route says"
    assert pool["grid_wh"] == 15, "the rest to the grid"
    close(pool["revenue_usdc"], 15 * 0.013 + 15 * 0.006)
    close(out["flats"]["B"]["owes_usdc"], 15 * 0.013)


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


def test_a_flat_is_under_or_over_for_the_period_never_both():
    """Morning: A leaves 10, B takes 6. Afternoon: A takes 4 of C's. Per period A is net under by 6."""
    morning = {"available_wh": 30, "panel_wh": 26, "used": {"A": 0, "B": 16, "C": 10}}
    afternoon = {"available_wh": 30, "panel_wh": 30, "used": {"A": 14, "B": 10, "C": 6}}
    out = credits.settle_period([morning, afternoon], THREE, P, scale=1.0)
    a, b, c = (out["flats"][f] for f in "ABC")
    for x in (a, b, c):
        assert x["unused_wh"] == 0 or x["over_wh"] == 0, x
    assert (a["unused_wh"], b["over_wh"], c["unused_wh"]) == (6, 6, 4)
    assert out["pool"]["neighbor_wh"] == 6 and out["pool"]["grid_wh"] == 4
    close(out["spare_wh"] - out["pool"]["neighbor_wh"], 60 - 56), "spare minus neighbours = what left the building"


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
    enabled = True
    credits = object()

    def __init__(self):
        self.calls = []

    def credits_status(self, period_id):
        return {"posted": any(c[0] == "post" for c in self.calls), "total_in_usdc": 1.0, "period_id": None}

    def credit_claims(self, period_id):
        self.calls.append(("claims", period_id))
        return {"A": "0xclaimA", "B": None}

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
    assert chain["post_tx"] == "0xpost"
    led.arc = arc  # chain{} refreshes from the contract: claims appear, the posted period id stays
    c = led.period("2026-11-07", now=m)["chain"]
    assert c["fund_tx"] == "0xfund" and c["claims"]["A"] == "0xclaimA" and c["posted"] is True
    assert c["period_id"] == "0x" + __import__("hashlib").sha256(b"dynaura-credits:2026-11-07").hexdigest()
    assert led.settle(arc, "2026-11-07")["post_tx"] == "0xpost" and [x[0] for x in arc.calls].count("post") == 1, "settled once"

    class NotSetUp(FakeArc):  # arc.py without a key or ARC_CREDITS: a clear error, not a crash
        enabled, credits = False, None
    try:
        led.settle(NotSetUp(), "2026-11-08")
        raise AssertionError("settle without SolarCredits must refuse")
    except RuntimeError as e:
        assert "not set up" in str(e)
    assert arkiv.posts[-1][0] == "/credit_period" and arkiv.posts[-1][1]["post_tx"] == "0xpost"
    assert led.post_new_trades() == 1 and led.post_new_trades() == 0, "each trade goes to Arkiv once"
    w = led.window(15, now=m + 120)
    assert w["needs"] == {} and w["spare_wh"] > 0


def test_window_for_the_trader_carries_shop_demand():
    day0 = int(time.mktime(time.strptime("2026-11-07", "%Y-%m-%d")))
    m = day0 + 12 * 3600
    rows = [{"minute": m, "meter": "panel", "wh": 0.06, "solar_wh": 0.06, "sig": "s"},
            {"minute": m, "meter": "A", "wh": 0.02, "solar_wh": 0.02, "sig": "s"},
            {"minute": m, "meter": "B", "wh": 0.04, "solar_wh": 0.04, "sig": "s"}]
    done = {"id": 1, "ts": m, "mode": "ai", "request_id": "r", "summary": "", "output": {"routes": [{"to": "shop", "wh": 0.5}]}}

    class Sales:
        orders = {1: {"status": "open", "day": "2026-11-07", "want_wh": 2000}, 2: {"status": "settled", "day": "2026-11-07", "want_wh": 9000}}

    led = credits.Ledger(FakeStore(rows, [done]), FakeHw(6.0), path=str(Path(tempfile.mkdtemp()) / "c.db"), sales=Sales())
    for i in range(13):
        led.sample(5, now=m + i * 5)
    snap = led.window(5, now=m + 120)
    assert snap["shop_order_wh"] == 1.5, "open order 2000 real Wh = 2 model Wh, minus 0.5 already routed"
    assert snap["window"] == [snap["since"], snap["until"]] and snap["spare_wh"] > 0
    assert led.window(5, now=m + 3600)["spare_wh"] == 0, "an hour later: no readings, no spare"


def test_settle_through_dy_arcs_credits_settle_and_status():
    day0 = int(time.mktime(time.strptime("2026-11-07", "%Y-%m-%d")))
    m = day0 + 12 * 3600
    rows = [{"minute": m, "meter": "panel", "wh": 0.09, "solar_wh": 0.09, "sig": "s"},
            {"minute": m, "meter": "A", "wh": 0.01, "solar_wh": 0.01, "sig": "s"},
            {"minute": m, "meter": "B", "wh": 0.05, "solar_wh": 0.05, "sig": "s"},
            {"minute": m, "meter": "C", "wh": 0.03, "solar_wh": 0.03, "sig": "s"}]

    class Arc2:
        enabled, credits = True, object()

        def __init__(self):
            self.settles, self.status_calls = [], 0

        def credits_settle(self, key, flats, rate, fund, rhash):
            self.settles.append((key, flats, rate, fund, rhash))
            return {"period_id": "0xpid", "key": key, "posted": True, "post_tx": "0xpost", "fund_tx": "0xfund", "claims": {"A": None}}

        def credits_status(self, key):
            self.status_calls += 1
            return {"period_id": "0xpid", "posted": True, "post_tx": None,
                    "flats": {"A": {"claimed_usdc": 0.4, "claimable_usdc": 0}, "C": {"claimed_usdc": 0, "claimable_usdc": 0.1}}}

        def credit_claims(self, key):
            self.claim_calls = getattr(self, "claim_calls", 0) + 1
            return {"A": "0xclaimA"}

    arc = Arc2()
    led = credits.Ledger(FakeStore(rows), FakeHw(5.4), path=str(Path(tempfile.mkdtemp()) / "c.db"), arc=arc)
    for i in range(13):  # 5.4 W for a minute = 0.09 Wh: shares 0.03 each
        led.sample(5, now=m + i * 5)
    assert led.period("2026-11-07", now=m)["chain"] is None, "not settled: no chain"
    chain = led.settle(arc, "2026-11-07")
    key, flats, rate, fund, rhash = arc.settles[0]
    assert key == "2026-11-07" and set(flats) == {"A", "B", "C"} and rate == 0.013 and rhash.startswith("0x")
    close(flats["A"]["unused_wh"], 0.02)
    close(flats["B"]["over_wh"], 0.02)
    p = led.period("2026-11-07", now=m)
    close(fund, p["pool"]["revenue_usdc"] - 0.02 * 0.013)  # shop + grid only: B pays its part with payIn
    assert chain["post_tx"] == "0xpost" and p["chain"]["claims"]["A"] == "0xclaimA", "claim tx from the logs"
    assert p["chain"]["flats"]["A"]["claimed"] is True and p["chain"]["flats"]["C"]["claimed"] is False
    assert p["chain"]["post_tx"] == "0xpost", "a None from status doesn't hide what settle saved"
    led.period("2026-11-07", now=m)
    assert arc.status_calls == 1 and arc.claim_calls == 1, "status cached 20 s, claim logs 60 s"
    led.settle(arc, "2026-11")  # a month works too (dy-arc's keys)
    assert arc.settles[1][0] == "2026-11"


def test_settle_resumes_from_the_chain_never_posts_or_funds_twice():
    day0 = int(time.mktime(time.strptime("2026-11-07", "%Y-%m-%d")))
    m = day0 + 12 * 3600
    rows = [{"minute": m, "meter": "panel", "wh": 0.06, "solar_wh": 0.06, "sig": "s"},
            {"minute": m, "meter": "A", "wh": 0.02, "solar_wh": 0.02, "sig": "s"},
            {"minute": m, "meter": "B", "wh": 0.04, "solar_wh": 0.04, "sig": "s"}]

    class Chain:
        enabled, credits = True, object()

        def __init__(self, fail_fund=False):
            self.posted, self.funded, self.calls, self.fail_fund = False, False, [], fail_fund

        def credits_status(self, pid):
            return {"posted": self.posted}

        def credit_txs(self, pid):
            return {"post_tx": "0xpost" if self.posted else None, "fund_tx": "0xfund" if self.funded else None, "claims": {}}

        def post_credits(self, *a):
            assert not self.posted, "AlreadyPosted"
            self.posted = True
            self.calls.append("post")
            return "0xpost"

        def fund_credits(self, *a):
            if self.fail_fund:
                raise OSError("rpc down")
            self.funded = True
            self.calls.append("fund")
            return "0xfund"

        def credit_claims(self, pid):
            return {}

    arc = Chain(fail_fund=True)
    led = credits.Ledger(FakeStore(rows), FakeHw(6.0), path=str(Path(tempfile.mkdtemp()) / "c.db"), shares="A:1,B:1,C:0")
    for i in range(13):
        led.sample(5, now=m + i * 5)
    try:
        led.settle(arc, "2026-11-07")
    except OSError:
        pass
    assert arc.calls == ["post"], "posted, then the fund failed"
    arc.fail_fund = False
    chain = led.settle(arc, "2026-11-07")
    assert arc.calls == ["post", "fund"] and chain["post_tx"] == "0xpost" and chain["fund_tx"] == "0xfund"
    fresh = credits.Ledger(FakeStore(rows), FakeHw(6.0), path=str(Path(tempfile.mkdtemp()) / "c2.db"), shares="A:1,B:1,C:0")
    fresh.settle(arc, "2026-11-07")  # a wiped credits.db: the chain still says posted and funded
    assert arc.calls == ["post", "fund"], "never posted or funded twice"


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
