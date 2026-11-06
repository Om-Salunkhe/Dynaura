"""0G sells the spare sun (fair share + solar credits).

Each flat has a fair share of the panel. What a flat leaves unused is the spare pool; 0G, the
market maker, decides who buys it in each window:
  - a neighbour flat that used more than its share, at a neighbour price inside the
    export..import band (savers earn more than feed-in, the neighbour pays less than the grid)
  - the shop, up to its order, at the shop price
  - the grid, at the feed-in rate, for anything left

    decide_routes(spare_wh, needs, shop_order_wh, prices, store=, uploader=, notify=, window=) -> dict

The Pi checks 0G's answer: routes never exceed the spare, only flats that used more than their share
can buy (at most what they used over it), the shop gets at most its order, and the neighbour price
stays inside the band. Whatever 0G does not route goes to the grid. The decision is recorded as kind
"trade" with its episode on 0G Storage and EpisodeRegistry, like every other decision.

No 0G (down, TEE check failed, no usable answer): no AI trade. A fixed rule, recorded as mode "no-ai"
and never shown as a 0G decision: neighbours' drawn energy is settled at the default midpoint price,
nothing goes to the shop (that is an AI decision; ShopTrade refunds the prepay), the rest to the grid.

Wh are model Wh (1 Wh on the model = BILL_SCALE/1000 kWh in the real building); prices are USDC per
real kWh.
"""
import json
import logging
import os
import threading
import time
from datetime import datetime

import config
import zg

log = logging.getLogger("dynaura.trader")

FLATS = ("A", "B", "C")


def _rate(name: str, default: str) -> float | None:
    raw = os.getenv(name, default).strip()
    return float(raw) if raw else None


# Prices, USDC per real kWh. Import = GRID_RATE_USDC; shop = SHOP_PRICE_USDC (both in config.py).
EXPORT_RATE_USDC = _rate("EXPORT_RATE_USDC", "0.006")      # feed-in: what the grid pays for spare sun
NEIGHBOR_RATE_USDC = _rate("NEIGHBOR_RATE_USDC", "")       # empty = midpoint of export and import
TRADE_EVERY_MIN = float(os.getenv("TRADE_EVERY_MIN", "15") or 15)
TRADE_MIN_WH = float(os.getenv("TRADE_MIN_WH", "0.5") or 0.5)  # less spare than this: no trade
TRADE_MIN_GAP_S = 60.0  # never more than one 0G trade call a minute (SIM_SPEED makes windows short)
# 0gm-1.0 is Qwen3-based and "thinks" first: ~80 s per trade with thinking, ~6 s without (measured
# Sat 01:00 on router-api.0g.ai). A trade is a short, rule-bound choice, so thinking is off by default.
TRADE_THINKING = os.getenv("TRADE_THINKING", "false").lower() == "true"
NO_THINKING = {"chat_template_kwargs": {"enable_thinking": False}}

SYSTEM = """You are Dyna, the market maker for the shared rooftop solar panel of a small apartment building with flats A, B and C.
Each flat has an equal fair share of the sun. What a flat leaves unused goes into a spare pool. The pool is sold,
and the money goes back to the flats that saved, in proportion to how much each left unused.
Neighbours who used more than their share already drew that sun, so they are served first from the pool, by rule.
You decide two things:
1. The neighbour price, between the feed-in (export) rate and the grid import rate. When the spare is scarce
   (neighbours need most of it), price toward the import rate. When it is plentiful, price toward the export rate.
   A fair guide: export + (import - export) x the share of the pool the neighbours take.
2. How the rest of the pool (after the neighbours) is split: the shop takes up to its order at the shop price,
   and the grid takes anything left at the feed-in rate.
Answer with ONE JSON object only, no other text:
{"neighbor_price": <USDC per kWh>, "shop_wh": <number>, "reason": "one short sentence"}"""


def current_prices() -> dict:
    """{export, import, shop, neighbor}: USDC per real kWh. neighbor = midpoint unless set."""
    exp, imp = EXPORT_RATE_USDC, config.GRID_RATE_USDC
    lo, hi = min(exp, imp), max(exp, imp)
    mid = round((lo + hi) / 2, 6)
    neighbor = NEIGHBOR_RATE_USDC if NEIGHBOR_RATE_USDC is not None and lo <= NEIGHBOR_RATE_USDC <= hi else mid
    return {"export": exp, "import": imp, "shop": config.SHOP_PRICE_USDC, "neighbor": neighbor}


prices = current_prices  # trader.prices()


def _num(x) -> float | None:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if v == v and abs(v) != float("inf") else None


def _buyer(to) -> str | None:
    s = str(to or "").strip()
    if s.lower() in ("shop", "grid"):
        return s.lower()
    s = s.upper().removeprefix("FLAT").strip()
    return s if s in FLATS else None


NO_AI_REASON = "fixed rule: drawn energy settled at the midpoint; no AI pricing"


def neighbours_first(spare_wh: float, needs: dict, price: float) -> tuple[list, float, list]:
    """Flats that used more than their share already drew that sun from the pool: they are served
    first, pro rata if together they need more than the spare. -> (routes, Wh left, notes)."""
    notes = []
    over = {f: max(0.0, _num(needs.get(f)) or 0.0) for f in FLATS}
    need = sum(over.values())
    scale = 1.0 if need <= spare_wh else spare_wh / need
    if scale < 1:
        notes.append(f"neighbours need {need:g} Wh, spare is {spare_wh:g} Wh: shared pro rata")
    routes = [{"to": f, "wh": round(over[f] * scale, 3), "price": price} for f in FLATS if over[f] > 0]
    left = round(spare_wh - sum(r["wh"] for r in routes), 3)
    if left < 0:  # rounding
        routes[-1]["wh"] = round(routes[-1]["wh"] + left, 3)
        left = 0.0
    return routes, left, notes


def validate(answer: dict, spare_wh: float, needs: dict, shop_order_wh: float, px: dict) -> tuple[list, float, list]:
    """0G's answer -> (routes, neighbour price, notes). Routes always add up to spare_wh exactly.

    Neighbours who used more than their share are served first, by rule (pro rata if they need more than
    the spare). 0G sets the neighbour price (kept inside [export, import]) and how much of the rest the
    shop takes (at most its order); the grid gets what is left. Raises zg.ZGUnavailable if the answer
    has neither a price nor a shop amount nor routes."""
    if not isinstance(answer, dict) or not any(k in answer for k in ("neighbor_price", "shop_wh", "routes")):
        raise zg.ZGUnavailable(f"0G trade answer has no price, shop amount or routes: {str(answer)[:120]}")
    notes = []
    lo, hi = min(px["export"], px["import"]), max(px["export"], px["import"])
    price = _num(answer.get("neighbor_price"))
    if price is None:
        price = px["neighbor"]
        notes.append(f"no neighbour price from 0G: midpoint {price}")
    elif not lo <= price <= hi:
        clamped = min(hi, max(lo, price))
        notes.append(f"neighbour price {price} outside [{lo}, {hi}]: set to {clamped}")
        price = clamped
    price = round(price, 6)

    # 1. neighbours first: their over-use was physically drawn from the pool
    routes, left, more = neighbours_first(spare_wh, needs, price)
    notes += more

    # 2. the shop, as 0G decides (older answers may give it as a route)
    shop = _num(answer.get("shop_wh"))
    if shop is None and isinstance(answer.get("routes"), list):
        shop = sum(_num(r.get("wh")) or 0.0 for r in answer["routes"]
                   if isinstance(r, dict) and _buyer(r.get("to")) == "shop") or None
    if shop is None:
        shop = 0.0
        notes.append("no shop amount from 0G: the rest goes to the grid")
    cap = min(max(0.0, _num(shop_order_wh) or 0.0), left)
    give = round(min(max(0.0, shop), cap), 3)
    if give < shop - 1e-9:
        notes.append(f"shop: {shop:g} Wh asked, {give:g} Wh allowed")
    if give > 0:
        routes.append({"to": "shop", "wh": give, "price": px["shop"]})

    # 3. the grid takes the rest
    grid = round(spare_wh - sum(r["wh"] for r in routes), 3)
    if grid > 0:
        routes.append({"to": "grid", "wh": grid, "price": px["export"]})
    return routes, price, notes


def _window_text(window) -> str:
    """["12:00", "12:15"] or [from_unix, to_unix] -> "12:00-12:15"."""
    if not window:
        return "now"
    parts = []
    for w in window:
        n = _num(w)
        parts.append(datetime.fromtimestamp(n).strftime("%H:%M") if n is not None and n > 1e8 else str(w))
    return "-".join(parts)


def from_ledger(snap: dict) -> dict:
    """credits.py's window() -> {spare_wh, needs, shop_order_wh, prices, window}.
    Accepts since/until (unix) and prices.neighbor_default as well as this module's own names."""
    snap = snap or {}
    px = dict(snap.get("prices") or {})
    if "neighbor" not in px and px.get("neighbor_default") is not None:
        px["neighbor"] = px["neighbor_default"]
    px = {k: v for k, v in px.items() if k in ("export", "import", "shop", "neighbor") and _num(v) is not None}
    window = snap.get("window")
    if not window and snap.get("since") is not None:
        window = [snap.get("since"), snap.get("until")]
    return {"spare_wh": snap.get("spare_wh") or 0.0, "needs": snap.get("needs") or {},
            "shop_order_wh": snap.get("shop_order_wh") or 0.0, "prices": px or None, "window": window}


def build_prompt(spare_wh: float, needs: dict, shop_order_wh: float, px: dict, window) -> str:
    over = {f: _num(w) or 0.0 for f, w in needs.items() if (_num(w) or 0) > 0}
    need = sum(over.values())
    to_neighbours = min(need, spare_wh)
    lo, hi = min(px["export"], px["import"]), max(px["export"], px["import"])
    who = ", ".join(f"Flat {f} used {w:g} Wh over its share" for f, w in over.items())
    return (
        f"Window {_window_text(window)}. Spare sun in the pool: {spare_wh:g} Wh "
        f"(1 Wh here = {config.BILL_SCALE / 1000:g} kWh in the real building).\n"
        f"Neighbours served first: {who or 'none'}; {to_neighbours:g} Wh of the pool "
        f"({100 * to_neighbours / spare_wh:.0f}%) goes to them.\n"
        f"Left after the neighbours: {spare_wh - to_neighbours:g} Wh. Shop order: {shop_order_wh:g} Wh at {px['shop']} USDC/kWh.\n"
        f"Grid import {px['import']} USDC/kWh, feed-in {px['export']} USDC/kWh. "
        f"Neighbour price band [{lo}, {hi}], midpoint {px['neighbor']}.\n"
        "Set the neighbour price and the shop amount."
    )


def _summary(routes: list, mode: str) -> str:
    parts = ", ".join(f"{'Flat ' + r['to'] if r['to'] in FLATS else r['to']} {r['wh']:g} Wh @ {r['price']:g}" for r in routes)
    return (f"0G sold the spare: {parts}" if mode == "ai"
            else f"No 0G, fixed rule (no AI pricing): {parts}")[:200]


def decide_routes(spare_wh: float, needs: dict, shop_order_wh: float = 0.0, prices: dict | None = None, *,
                  store=None, uploader=None, notify=None, window=None) -> dict:
    """Ask 0G who gets the spare. Never raises: without 0G a fixed rule applies (mode no-ai, see above).
    With store= the decision is recorded (kind "trade") and its episode uploaded; without it, nothing is."""
    px = {**current_prices(), **(prices or {})}
    spare_wh = round(max(0.0, _num(spare_wh) or 0.0), 3)
    needs = {f: round(max(0.0, _num((needs or {}).get(f)) or 0.0), 3) for f in FLATS}
    shop_order_wh = round(max(0.0, _num(shop_order_wh) or 0.0), 3)
    window = list(window) if window else None
    base = {"spare_wh": spare_wh, "needs": needs, "shop_order_wh": shop_order_wh, "prices": px, "window": window}
    if spare_wh <= 0:
        return {"routes": [], "reason": "no spare sun", "request_id": None, "mode": "none", "decision_id": None,
                "neighbor_price": px["neighbor"], "model": None, "tee": None, "window": window}

    prompt = build_prompt(spare_wh, needs, shop_order_wh, px, window)
    reply = None
    try:
        reply = _ask(prompt)
        answer = zg.extract_json(reply.text)
        routes, price, notes = validate(answer, spare_wh, needs, shop_order_wh, px)
    except zg.ZGUnavailable as e:
        # No 0G: a fixed rule, never shown as a 0G decision. Neighbours' drawn energy is settled at the
        # default (midpoint) price, nothing is sold to the shop (that is an AI decision; ShopTrade refunds
        # the prepay as usual), and the rest goes to the grid at the feed-in rate.
        routes, left, notes = neighbours_first(spare_wh, needs, px["neighbor"])
        if left > 0:
            routes.append({"to": "grid", "wh": left, "price": px["export"]})
        out = {**base, "routes": routes, "reason": NO_AI_REASON, "neighbor_price": px["neighbor"], "state": "no_ai",
               "rule": "neighbours_first_midpoint", "notes": notes, "zg_error": str(e)[:300],
               "zg_request_id": reply.request_id if reply else None}
        did = None
        if store is not None:
            did = store.add_decision("trade", "no-ai", _summary(routes, "no-ai"), out, input=prompt)
            _publish(did, uploader, notify, {"raw_answer": reply.text} if reply else None)
        log.warning("trade: no 0G, fixed rule (decision #%s): %s", did, e)
        return {"routes": routes, "reason": NO_AI_REASON, "request_id": None, "mode": "no-ai", "decision_id": did,
                "neighbor_price": px["neighbor"], "model": None, "tee": None, "window": window,
                "rule": "neighbours_first_midpoint", "notes": notes, "zg_error": str(e)[:300]}

    reason = str(answer.get("reason") or "")[:240]
    out = {**base, "routes": routes, "reason": reason, "neighbor_price": price, "notes": notes}
    did = None
    if store is not None:
        did = store.add_decision("trade", "ai", _summary(routes, "ai"), out, request_id=reply.request_id,
                                 model=reply.model, tee=reply.tee, input=prompt)
        _publish(did, uploader, notify, {"raw_answer": reply.text})
    log.info("trade #%s (0G %s): %s", did, reply.request_id, _summary(routes, "ai"))
    return {"routes": routes, "reason": reason, "request_id": reply.request_id, "mode": "ai", "decision_id": did,
            "neighbor_price": price, "model": reply.model, "tee": reply.tee_verified, "window": window,
            "notes": notes}


def _ask(prompt: str) -> zg.ZGReply:
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}]
    if not TRADE_THINKING:
        try:
            return zg.chat(messages, max_tokens=4000, temperature=0.2, extra_body=NO_THINKING)
        except zg.ZGModelUnavailable as e:  # the Router answered but refused the option: ask with thinking
            log.warning("0G refused enable_thinking=false, asking with thinking: %s", e)
    return zg.chat(messages, max_tokens=4000, temperature=0.2)


def _publish(did: int, uploader, notify, extra: dict | None) -> None:
    """Episode to 0G Storage + EpisodeRegistry (then Arkiv), like every other decision."""
    if uploader:
        uploader.enqueue(did, extra)
    if notify:
        try:
            notify(did)
        except Exception:
            log.exception("decision callback failed")


def trades(store, since_ts: float | None = None, limit: int = 100) -> list[dict]:
    """Recorded trades, newest first, in the shared API's shape."""
    out = []
    for d in store.decisions("trade", limit):
        if since_ts is not None and d["ts"] < since_ts:
            continue
        o = d.get("output") or {}
        out.append({"at": d["ts"], "window": o.get("window"), "routes": o.get("routes") or [],
                    "request_id": d.get("request_id"), "mode": d["mode"], "reason": o.get("reason"),
                    "neighbor_price": o.get("neighbor_price"), "decision_id": d["id"],
                    "storage_root": d.get("storage_root")})
    return out


class TradeLoop:
    """Every TRADE_EVERY_MIN (sim: once per sim window, at most once a real minute) asks
    snapshot() -> credits.py's window() (or {spare_wh, needs, shop_order_wh, window}) | None,
    and trades when there is spare. On the Pi: TradeLoop(lambda: App.credits.window(TRADE_EVERY_MIN), ...)."""

    def __init__(self, snapshot, *, store=None, uploader=None, notify=None, speed: float | None = None):
        self.snapshot = snapshot
        self.store, self.uploader, self.notify = store, uploader, notify
        speed = speed if speed is not None else (config.SIM_SPEED if config.HW == "sim" else 1.0)
        self.interval_s = max(TRADE_MIN_GAP_S, TRADE_EVERY_MIN * 60 / max(speed, 0.001))
        self.last: dict | None = None
        self.error: str | None = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def run_now(self) -> dict:
        with self._lock:
            try:
                snap = from_ledger(self.snapshot())
            except Exception as e:
                self.error = f"credits snapshot failed: {e}"
                log.exception("credits snapshot failed")
                return {"skipped": self.error}
            spare = _num(snap["spare_wh"]) or 0.0
            if spare <= TRADE_MIN_WH:
                return {"skipped": "no spare sun to sell", "spare_wh": round(spare, 3)}
            self.last = decide_routes(spare, snap["needs"], snap["shop_order_wh"], snap["prices"],
                                      store=self.store, uploader=self.uploader, notify=self.notify,
                                      window=snap["window"])
            self.last["at"] = time.time()
            self.error = None
            return self.last

    def status(self) -> dict:
        return {"interval_s": round(self.interval_s), "last": self.last, "error": self.error,
                "running": bool(self._thread and self._thread.is_alive())}

    def _run(self) -> None:
        while not self._stop.wait(self.interval_s):
            try:
                self.run_now()
            except Exception as e:  # never let a bad window stop the loop
                self.error = str(e)
                log.exception("trade loop step failed")

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="0g-trader", daemon=True)
        self._thread.start()
        log.info("0G trader on: every %ds while spare > %g Wh", self.interval_s, TRADE_MIN_WH)

    def stop(self) -> None:
        self._stop.set()


if __name__ == "__main__":  # python trader.py: one live 0G trade with Pawan's example, nothing recorded
    logging.basicConfig(level=logging.INFO)
    now = datetime.now().strftime("%H:%M")
    print(json.dumps(decide_routes(40, {"B": 0, "C": 15}, 20, window=[now, now]), indent=2))
