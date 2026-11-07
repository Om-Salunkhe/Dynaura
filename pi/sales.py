"""Spare noon solar sold to nearby shops on Arc (ShopTrade).

A shop prepays in the app for some Wh of today's offer. When the solar window closes, the Pi
settles every open order: the society is paid for what was delivered and the shop gets the
rest back in the same transaction. Each sale is also written to Arkiv.
"""
import logging
import threading
import time
from datetime import datetime

import config
from arc import ArcUnavailable

log = logging.getLogger("dynaura.sales")


def window_end(brain, day: str) -> float:
    plan = brain.plan or {}
    end = (plan.get("solar_window") or ["10:00", "15:00"])[1] if plan.get("date") == day else "15:00"
    return datetime.strptime(f"{day} {end}", "%Y-%m-%d %H:%M").timestamp()


def delivered_wh(order: dict, cleaning_status: dict | None) -> int:
    """How much of the order the building delivered.

    The model building has no meter on the shop line, so this is the ordered energy scaled by
    how well the panel performed (a dusty panel delivers less, and the shop is refunded the rest).
    On a real building, the export meter reading for the window goes here; nothing else changes.
    """
    pct = (cleaning_status or {}).get("pct")
    ratio = 1.0 if pct is None else max(0.0, min(1.0, pct / 100))
    return int(order["want_wh"] * ratio)


class ShopSettler:
    def __init__(self, arc, brain, cleaning=None, interval: float = 10.0):
        self.arc = arc
        self.brain = brain
        self.cleaning = cleaning
        self.interval = interval
        self.orders: dict[int, dict] = {}
        self.sales: list[dict] = []
        self.offer: dict | None = None
        self.on_offer = None  # callback(offer dict) -> Arkiv
        self.on_sale = None   # callback(sale dict) -> Arkiv
        self.routed = None    # callback(order dict) -> model Wh 0G really routed after detection
        self.error: str | None = None
        self._next = 1
        self._backoff = 0.0  # extra wait after Arc rate-limits us (429), so the loop doesn't keep the IP throttled
        self._stop = threading.Event()

    def step(self, now: float | None = None) -> None:
        if not (self.arc.enabled and self.arc.shop):
            return
        now = now or time.time()
        try:
            last = self.arc.next_order_id()
            while self._next < last:  # pick up new orders
                order = self.arc.order(self._next)
                if order["status"] == "open":
                    order["detected_at"] = now
                    # the shop's prepay on Arc, so the app can link it as the sale's proof
                    try:  # the prepay tx is only a proof link: never let its log lookup block the order
                        order["tx"] = self.arc.order_tx(self._next) if hasattr(self.arc, "order_tx") else None
                    except Exception as e:
                        log.info("order %s: prepay tx lookup skipped (%s)", self._next, str(e)[:120])
                        order["tx"] = None
                    # An offer is single-use. Once Arc proves a buyer prepaid it, never let the
                    # same measured capacity reappear after the order settles.
                    self.offer = None
                self.orders[self._next] = order
                self._next += 1
            for oid, o in list(self.orders.items()):
                if o["status"] != "open":
                    continue
                # The order deadline is the delivery window the buyer saw.  Do not use the
                # day-plan's default 15:00 cutoff here: a measured live offer may be created later
                # in the day, and settling it immediately would refund it before 0G can route the
                # next metered window.
                if now >= o["deadline"]:
                    self.settle(oid)
            self.error = None
            self._backoff = 0.0
        except ArcUnavailable as e:
            self.error = str(e)
        except Exception as e:
            self.error = str(e)[:200]
            if "429" in self.error or "rate limit" in self.error.lower():
                self._backoff = min(300.0, max(20.0, self._backoff * 2))
            log.warning("shop settle failed: %s%s", self.error,
                        f" (next try in {self.interval + self._backoff:.0f} s)" if self._backoff else "")

    def settle(self, order_id: int) -> dict:
        o = self.orders.get(order_id) or self.arc.order(order_id)
        if self.routed and o.get("detected_at"):
            routed_real_wh = int(round(max(0.0, float(self.routed(o) or 0)) * config.BILL_SCALE))
            already = sum(int(s.get("delivered_wh") or 0) for s in self.sales if s.get("day") == o["day"])
            wh = min(int(o["want_wh"]), max(0, routed_real_wh - already))
        else:
            wh = delivered_wh(o, self.cleaning.status if self.cleaning else None)
        paid, back, tx = self.arc.settle_order(order_id, wh)
        o.update(status="settled", delivered_wh=wh)
        o["settle_tx"] = tx
        sale = {"order_id": order_id, "buyer": o["shop"], "kwh": wh / 1000, "usdc": paid,
                "delivered_wh": wh, "refunded": back, "arc_tx": tx, "prepay_tx": o.get("tx"), "day": o["day"]}
        self.sales.insert(0, sale)
        log.info("order #%s settled: %s Wh, %.4f USDC to society, %.4f back to shop", order_id, wh, paid, back)
        if self.on_sale:
            try:
                self.on_sale(sale)
            except Exception:
                log.exception("sale callback failed")
        return sale

    def _publish_offer(self, offer: dict) -> dict:
        self.offer = {**offer, "published_at": int(time.time())}
        if self.on_offer:
            try:
                self.on_offer(self.offer)
            except Exception:
                log.exception("offer callback failed")
        log.info("market offer: %.3f kWh at %.4f USDC/kWh until %s", self.offer["kwh"],
                 self.offer["price_usdc"], self.offer["window_end"])
        return self.offer

    def publish_plan_offer(self, offer: dict) -> dict | None:
        """Publish a day-ahead offer produced by the real 0G daily plan."""
        if float(offer.get("kwh") or 0) <= 0:
            return None
        return self._publish_offer({**offer, "source": "0g-plan"})

    def offer_from_trade(self, trade: dict, snapshot: dict, now: float | None = None) -> dict | None:
        """Turn measured spare that 0G sent to the grid into the next live shop offer.

        A shop route is never invented here. Until a shop prepays on Arc, the current window still
        goes to the grid; the offer advertises that measured capacity for a following window.
        """
        now = now or time.time()
        if trade.get("mode") != "ai" or not trade.get("request_id"):
            return None
        day = datetime.fromtimestamp(now).strftime("%Y-%m-%d")
        if any(o.get("status") == "open" and o.get("day") == day for o in self.orders.values()):
            return None
        if self.offer and self.offer.get("window_end", 0) > now:
            return self.offer
        grid_wh = sum(float(r.get("wh") or 0) for r in trade.get("routes") or [] if r.get("to") == "grid")
        if grid_wh < config.TRADE_MIN_WH:
            return None
        kwh = round(grid_wh * config.BILL_SCALE / 1000, 3)
        if kwh <= 0:
            return None
        return self._publish_offer({
            "day": day,
            "kwh": kwh,
            "price_usdc": float((snapshot.get("prices") or {}).get("shop") or config.SHOP_PRICE_USDC),
            "window_end": int(now + config.MARKET_OFFER_TTL_MIN * 60),
            "request_id": trade["request_id"],
            "source": "metered-spare",
        })

    @property
    def status(self) -> dict:
        today = datetime.now().strftime("%Y-%m-%d")
        open_today = any(o.get("status") == "open" and o.get("day") == today for o in self.orders.values())
        active = self.offer if self.offer and self.offer.get("window_end", 0) > time.time() and not open_today else None
        return {"offer": active, "price_usdc": config.SHOP_PRICE_USDC,
                "orders": sorted(self.orders.values(), key=lambda o: -o["order_id"])[:20],
                "sales": self.sales[:20], "error": self.error}

    def _run(self) -> None:
        while not self._stop.wait(self.interval + self._backoff):
            self.step()

    def start(self) -> None:
        threading.Thread(target=self._run, name="shop-settle", daemon=True).start()

    def stop(self) -> None:
        self._stop.set()
