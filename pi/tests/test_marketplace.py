"""The real market lifecycle: measured offer -> prepaid order -> routed Wh -> Arc settlement."""
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config  # noqa: E402
from sales import ShopSettler  # noqa: E402


class Arc:
    enabled = True
    shop = object()

    def __init__(self):
        self.orders = {}
        self.settled = []

    def next_order_id(self):
        return max(self.orders, default=0) + 1

    def order(self, order_id):
        return dict(self.orders[order_id])

    def settle_order(self, order_id, delivered_wh):
        self.settled.append((order_id, delivered_wh))
        return delivered_wh * 0.08 / 1000, (self.orders[order_id]["want_wh"] - delivered_wh) * 0.08 / 1000, "0xsettled"


class Brain:
    plan = None


def test_marketplace():
    now = time.time()
    day = datetime.fromtimestamp(now).strftime("%Y-%m-%d")
    arc = Arc()
    market = ShopSettler(arc, Brain())
    offers, sales = [], []
    market.on_offer = offers.append
    market.on_sale = sales.append

    trade = {"mode": "ai", "request_id": "zg-real-1", "routes": [{"to": "grid", "wh": 0.06}]}
    snap = {"prices": {"shop": 0.08}}
    offer = market.offer_from_trade(trade, snap, now)
    assert offer["kwh"] == round(0.06 * config.BILL_SCALE / 1000, 3)
    assert offer["day"] == day and offer["request_id"] == "zg-real-1" and offers == [offer]
    assert market.offer_from_trade({"mode": "no-ai", "routes": trade["routes"]}, snap, now) is None

    deadline = int(now + 300)
    arc.orders[1] = {
        "order_id": 1, "shop": "0xbuyer", "deposit_usdc": 0.0048, "want_wh": 60,
        "delivered_wh": 0, "price_per_kwh": 0.08, "deadline": deadline, "status": "open", "day": day,
    }
    market.step(now + 1)
    assert market.orders[1]["detected_at"] == now + 1
    assert market.status["offer"] is None, "the purchased offer is consumed, never shown twice"
    assert arc.settled == [], "a live offer created after 15:00 must not settle against the old default window"

    market.routed = lambda order: 0.04  # model Wh; BILL_SCALE=1000 => 40 real Wh
    market.step(deadline - 1)
    assert arc.settled == []
    market.step(deadline)
    assert arc.settled == [(1, 40)]
    assert sales[0]["delivered_wh"] == 40 and sales[0]["refunded"] > 0
    assert market.orders[1]["status"] == "settled"


if __name__ == "__main__":
    test_marketplace()
    print("marketplace: all checks passed")
