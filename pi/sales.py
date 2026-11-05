"""Spare noon solar sold to nearby shops on Arc (ShopTrade).

A shop prepays in the app for some Wh of today's offer. When the solar window closes, the Pi
settles every open order: the society is paid for what was delivered and the shop gets the
rest back in the same transaction. Each sale is also written to Arkiv.
"""
import logging
import threading
import time
from datetime import datetime

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
    def __init__(self, arc, brain, cleaning=None, interval: float = 30.0):
        self.arc = arc
        self.brain = brain
        self.cleaning = cleaning
        self.interval = interval
        self.orders: dict[int, dict] = {}
        self.sales: list[dict] = []
        self.on_sale = None   # callback(sale dict) -> Arkiv
        self.error: str | None = None
        self._next = 1
        self._stop = threading.Event()

    def step(self, now: float | None = None) -> None:
        if not (self.arc.enabled and self.arc.shop):
            return
        now = now or time.time()
        try:
            last = self.arc.next_order_id()
            while self._next < last:  # pick up new orders
                self.orders[self._next] = self.arc.order(self._next)
                self._next += 1
            for oid, o in list(self.orders.items()):
                if o["status"] != "open":
                    continue
                if now >= min(window_end(self.brain, o["day"]), o["deadline"] - 120):
                    self.settle(oid)
            self.error = None
        except ArcUnavailable as e:
            self.error = str(e)
        except Exception as e:
            self.error = str(e)[:200]
            log.warning("shop settle failed: %s", self.error)

    def settle(self, order_id: int) -> dict:
        o = self.orders.get(order_id) or self.arc.order(order_id)
        wh = delivered_wh(o, self.cleaning.status if self.cleaning else None)
        paid, back, tx = self.arc.settle_order(order_id, wh)
        o.update(status="settled", delivered_wh=wh)
        sale = {"order_id": order_id, "buyer": o["shop"], "kwh": wh / 1000, "usdc": paid,
                "refunded": back, "arc_tx": tx, "day": o["day"]}
        self.sales.insert(0, sale)
        log.info("order #%s settled: %s Wh, %.4f USDC to society, %.4f back to shop", order_id, wh, paid, back)
        if self.on_sale:
            try:
                self.on_sale(sale)
            except Exception:
                log.exception("sale callback failed")
        return sale

    @property
    def status(self) -> dict:
        return {"orders": sorted(self.orders.values(), key=lambda o: -o["order_id"])[:20],
                "sales": self.sales[:20], "error": self.error}

    def _run(self) -> None:
        while not self._stop.wait(self.interval):
            self.step()

    def start(self) -> None:
        threading.Thread(target=self._run, name="shop-settle", daemon=True).start()

    def stop(self) -> None:
        self._stop.set()
