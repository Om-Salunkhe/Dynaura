"""Fair share + solar credits: each flat is paid for the sun it left for others.

The panel's sun is split into equal fair shares (FLAT_SHARES). A flat that uses less than its share
leaves the rest, its *unused* sun, for the building to sell: to a neighbour that needs more than its
own share, to the shop, or to the grid. The money from those sales (the pool, R) goes back to the
flats in proportion to what each left unused:

    earned[f] = R * unused[f] / sum(unused)        (an equal split would pay R / n)

Per minute, from the Pi's signed 1-minute summaries plus what the panel *could* give:
    available  what the panel could give (sim: hw.solar_available_w(); real board: see available_w())
    common     solar used by common loads (the pump): what the panel meter drew beyond the flats
    share[f]   (available - common) * weight[f] / sum(weights)
    used[f]    the flat's solar use (its meter while its relay was on solar)
Summed over a period (today, a day, a month), then per period, as SolarCredits takes them:
    unused[f]  max(0, share - used)          over[f]  max(0, used - share): bought from neighbours
so a flat is either under its share or over it, never both, and sum(unused) - sum(over) is exactly
the sun that left the building.

The spare pool (sum of unused) goes to: neighbours (what the over-users took), the shop (the 0G
trader's shop routes), and the grid at the feed-in rate (the rest). With no 0G trade, nothing goes
to the shop: the spare goes to the grid, recorded as no-ai. A routing is never invented here.

Units: *_wh are model Wh, the meters' unit. 1 model Wh = BILL_SCALE/1000 real kWh. Prices are USDC
per real kWh, like billing.py. Behind CREDITS_ENABLED (default true); off = nothing runs.
"""
import hashlib
import json
import logging
import os
import sqlite3
import threading
import time
from datetime import datetime

import config
from hw import FLATS

log = logging.getLogger("dynaura.credits")


def _f(name: str, default: float) -> float:
    v = getattr(config, name, None)
    if v is None or v == "":
        v = os.getenv(name, "")
    return float(v) if str(v).strip() != "" else default


ENABLED = str(getattr(config, "CREDITS_ENABLED", os.getenv("CREDITS_ENABLED", "true"))).lower() == "true"
CREDITS_DB = os.getenv("CREDITS_DB", "credits.db")
SAMPLE_S = 5.0          # how often the panel's available power is sampled
SHOP_DEMAND_WH = float(os.getenv("SHOP_DEMAND_WH", "0") or 0)  # standing shop demand per window (model Wh), on top of Arc orders
ARKIV_EVERY_S = 600     # today's credit period goes to Arkiv every 10 minutes
COMMON_NOISE = 0.03     # panel minus flats below 3% of the panel is meter noise, not the pump


def parse_shares(raw: str | None) -> dict[str, float]:
    """FLAT_SHARES=A:1,B:1,C:1 (default: equal shares for every flat)."""
    out = {f: 1.0 for f in FLATS}
    for part in (raw or "").replace(" ", "").split(","):
        if ":" in part:
            f, w = part.split(":", 1)
            if f in out:
                out[f] = max(0.0, float(w))
    return out


def prices() -> dict:
    """USDC per real kWh. The neighbour price defaults to the middle of the export..import band."""
    export = _f("EXPORT_RATE_USDC", 0.006)
    grid = _f("GRID_RATE_USDC", 0.02)
    # 0.001 USDC/kWh steps: SolarCredits keeps the rate per Wh in USDC base units (1 = 0.001/kWh)
    neighbor = round(_f("NEIGHBOR_RATE_USDC", 0) or (export + grid) / 2, 3)
    return {"export": export, "import": grid, "neighbor": neighbor, "shop": _f("SHOP_PRICE_USDC", 0.08)}


def kwh_per_wh() -> float:
    """Real kWh per model Wh (BILL_SCALE 1000: 1 model Wh = 1 real kWh)."""
    return _f("BILL_SCALE", 1000) / 1000


# ---- the model: pure, tested offline ---------------------------------------------------------

def minute_split(row: dict, weights: dict[str, float]) -> dict:
    """One minute. row = { available_wh, panel_wh, used: {flat: solar Wh} }."""
    used = {f: max(0.0, float(row["used"].get(f, 0.0))) for f in weights}
    used_total = sum(used.values())
    panel = max(0.0, float(row.get("panel_wh", used_total)))
    common = panel - used_total
    common = common if common > COMMON_NOISE * max(panel, 1e-9) else 0.0
    avail = max(float(row.get("available_wh") or 0.0), panel)  # never less than what was drawn
    net = max(0.0, avail - common)
    total_w = sum(weights.values()) or 1.0
    share = {f: net * w / total_w for f, w in weights.items()}
    unused = {f: max(0.0, share[f] - used[f]) for f in weights}
    over = {f: max(0.0, used[f] - share[f]) for f in weights}
    spare, wanted = sum(unused.values()), sum(over.values())
    neighbor = min(spare, wanted)
    paid = neighbor / wanted if wanted else 0.0  # if the estimate ran short, buyers pay only for what was spare
    return {"available": avail, "common": common, "share": share, "used": used, "unused": unused,
            "over": {f: over[f] * paid for f in weights}, "spare": spare, "neighbor": neighbor}


def trade_terms(trades: list[dict], p: dict) -> tuple[float, float, float]:
    """(shop_wh, neighbor_price, shop_price) from the 0G trades of a period. no-ai trades sell nothing
    to the shop; a neighbour price outside the export..import band is ignored."""
    shop_wh, shop_usdc = 0.0, 0.0
    n_wh, n_usdc = 0.0, 0.0
    for t in trades:
        if t.get("mode") != "ai":
            continue
        for r in t.get("routes") or []:
            wh, price = float(r.get("wh") or 0), float(r.get("price") or 0)
            if r.get("to") == "shop" and wh > 0:
                shop_wh += wh
                shop_usdc += wh * (price or p["shop"])
            elif r.get("to") in FLATS and wh > 0 and p["export"] <= price <= p["import"]:
                n_wh += wh
                n_usdc += wh * price
    neighbor = round(n_usdc / n_wh, 3) if n_wh else p["neighbor"]  # same 0.001 step as on chain
    shop = round(shop_usdc / shop_wh, 6) if shop_wh else p["shop"]
    return shop_wh, neighbor, shop


def settle_period(minutes: list[dict], weights: dict[str, float], p: dict | None = None,
                  trades: list[dict] | None = None, scale: float | None = None) -> dict:
    """Sum the minutes into a period and split its revenue. Returns the API's numbers."""
    p = dict(p or prices())
    trades = trades or []
    k = kwh_per_wh() if scale is None else scale
    tot = {"available": 0.0, "common": 0.0}
    per = {f: {"share": 0.0, "used": 0.0} for f in weights}
    for row in minutes:  # shares follow the sun minute by minute...
        m = minute_split(row, weights)
        tot["available"] += m["available"]
        tot["common"] += m["common"]
        for f in weights:
            per[f]["share"] += m["share"][f]
            per[f]["used"] += m["used"][f]
    for f in weights:  # ...but a flat is either under or over its share for the period, as on chain
        per[f]["unused"] = max(0.0, per[f]["share"] - per[f]["used"])
        per[f]["over"] = max(0.0, per[f]["used"] - per[f]["share"])
    tot["spare"] = sum(x["unused"] for x in per.values())
    tot["neighbor"] = min(tot["spare"], sum(x["over"] for x in per.values()))
    if tot["neighbor"] < sum(x["over"] for x in per.values()):  # meter noise: buyers pay only for what was spare
        ratio = tot["neighbor"] / sum(x["over"] for x in per.values())
        for x in per.values():
            x["over"] *= ratio
    shop_wanted, p["neighbor"], p["shop"] = trade_terms(trades, p)
    exportable = max(0.0, tot["spare"] - tot["neighbor"])
    shop_wh = min(exportable, shop_wanted)
    grid_wh = exportable - shop_wh
    revenue = (tot["neighbor"] * p["neighbor"] + shop_wh * p["shop"] + grid_wh * p["export"]) * k
    flats_in = [f for f, w in weights.items() if w > 0]
    flats = {}
    for f in weights:
        x = per[f]
        earned = revenue * x["unused"] / tot["spare"] if tot["spare"] else 0.0
        owes = x["over"] * k * p["neighbor"]
        flats[f] = {
            "weight": weights[f],
            "share_wh": round(x["share"], 4), "used_wh": round(x["used"], 4),
            "unused_wh": round(x["unused"], 4), "over_wh": round(x["over"], 4),
            "earned_usdc": round(earned, 6), "owes_usdc": round(owes, 6), "net_usdc": round(earned - owes, 6),
            "equal_split_usdc": round(revenue / len(flats_in), 6) if f in flats_in and flats_in else 0.0,
        }
    return {
        "available_wh": round(tot["available"], 4), "common_wh": round(tot["common"], 4),
        "spare_wh": round(tot["spare"], 4), "flats": flats,
        "pool": {"neighbor_wh": round(tot["neighbor"], 4), "shop_wh": round(shop_wh, 4), "grid_wh": round(grid_wh, 4),
                 "revenue_usdc": round(revenue, 6),
                 "prices": {"neighbor": p["neighbor"], "shop": p["shop"], "export": p["export"]}},
        "scale": {"real_kwh_per_wh": k},
    }


# ---- the ledger on the Pi --------------------------------------------------------------------

def _range(period: str, now: float | None = None) -> tuple[str, int, int]:
    """'today' | 'month' | 'YYYY-MM-DD' | 'YYYY-MM' -> (label, start, end) in unix seconds."""
    now_dt = datetime.fromtimestamp(now or time.time())
    if period in ("today", "", None):
        period = now_dt.strftime("%Y-%m-%d")
    elif period == "month":
        period = now_dt.strftime("%Y-%m")
    if len(period) == 10:
        start = datetime.strptime(period, "%Y-%m-%d")
        return period, int(start.timestamp()), int(start.timestamp()) + 86400
    start = datetime.strptime(period + "-01", "%Y-%m-%d")
    end = start.replace(year=start.year + 1, month=1) if start.month == 12 else start.replace(month=start.month + 1)
    return period, int(start.timestamp()), int(end.timestamp())


class Ledger:
    def __init__(self, store, hw, arkiv=None, *, path: str | None = None, shares: str | None = None, sales=None, arc=None):
        self.store = store
        self.hw = hw
        self.arkiv = arkiv
        self.arc = arc  # Arc client (arc.py): SolarCredits status for chain{}
        self._status: dict[str, tuple[float, dict]] = {}  # key -> (fetched at, credits_status)
        self.sales = sales  # ShopSettler: today's open shop orders are the shop's demand
        self.weights = parse_shares(shares if shares is not None else os.getenv("FLAT_SHARES", ""))
        self._db = sqlite3.connect(path or CREDITS_DB, check_same_thread=False, isolation_level=None)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.executescript("""
            CREATE TABLE IF NOT EXISTS available (minute INTEGER PRIMARY KEY, wh REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS settled (period TEXT PRIMARY KEY, chain TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS posted (what TEXT PRIMARY KEY, value INTEGER NOT NULL);
        """)
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._acc: dict[int, float] = {}
        self._forecast: tuple[float, dict] | None = None

    # ---- what the panel could give -----------------------------------------------------
    def available_w(self) -> float | None:
        """Sim knows it. The real board can't measure it (the panel meter reads only what is drawn):
        PANEL_AVAILABLE_W if set (e.g. the desk lamp), else PANEL_BEST_W in demo-clock mode, else
        PANEL_BEST_W x this hour's forecast radiation / 1000 W/m2. None when unknown: the minute then
        counts only what was drawn, so no spare is made up."""
        if hasattr(self.hw, "solar_available_w"):
            return float(self.hw.solar_available_w())
        fixed = _f("PANEL_AVAILABLE_W", 0)
        if fixed:
            return fixed
        best = _f("PANEL_BEST_W", 0)
        if not best:
            return None
        if getattr(config, "IGNORE_CLOCK", False):
            return best
        if self._forecast and not self._forecast[1] and time.time() - self._forecast[0] < 300:
            return None  # the last fetch failed: try again in 5 minutes, not every sample
        try:
            if not self._forecast or not self._forecast[1] or time.time() - self._forecast[0] > 1800:
                import forecast
                self._forecast = (time.time(), forecast.forecast_day("today"))
            hour = datetime.now().hour
            rad = next((h["radiation"] for h in self._forecast[1]["hours"] if h["hour"] == hour), 0.0)
            return best * min(1.0, max(0.0, rad / 1000))
        except Exception as e:
            log.info("no forecast for the available sun: %s", e)
            self._forecast = (time.time(), {})
            return None

    def sample(self, dt: float, now: float | None = None) -> None:
        """Add dt seconds at the current available power to this minute; close finished minutes."""
        now = now or time.time()
        w = self.available_w()
        minute = int(now // 60 * 60)
        with self._lock:
            if w is not None:
                self._acc[minute] = self._acc.get(minute, 0.0) + w * dt / 3600
            for m in [m for m in self._acc if m < minute]:
                self._db.execute("INSERT OR REPLACE INTO available (minute, wh) VALUES (?, ?)", (m, round(self._acc.pop(m), 6)))

    # ---- periods -----------------------------------------------------------------------
    def minutes(self, start: int, end: int) -> list[dict]:
        rows: dict[int, dict] = {}
        limit = max(60, (end - start) // 60 + 5)
        for meter in ("panel",) + tuple(FLATS):
            for s in self.store.summaries(meter=meter, since=start, limit=limit):
                if s["minute"] >= end:
                    continue
                r = rows.setdefault(s["minute"], {"minute": s["minute"], "panel_wh": 0.0, "used": {}, "sigs": []})
                if meter == "panel":
                    r["panel_wh"] = s["wh"]
                else:
                    r["used"][meter] = s["solar_wh"]
                r["sigs"].append((s["minute"], meter, s.get("sig")))
        with self._lock:
            avail = dict(self._db.execute("SELECT minute, wh FROM available WHERE minute >= ? AND minute < ?", (start, end)))
            for m, wh in self._acc.items():
                if start <= m < end:
                    avail[m] = wh
        for m, r in rows.items():
            r["available_wh"] = avail.get(m, r["panel_wh"])
        return [rows[m] for m in sorted(rows)]

    def trades(self, start: int, end: int) -> list[dict]:
        out = []
        for d in self.store.decisions("trade", 500):
            if not start <= d["ts"] < end:
                continue
            o = d.get("output") or {}
            out.append({
                "at": int(d["ts"]), "window": o.get("window"), "routes": o.get("routes") or [],
                "request_id": d.get("request_id"), "mode": d.get("mode"), "reason": o.get("reason") or d.get("summary"),
                "decision_id": d["id"], "spare_wh": o.get("spare_wh"), "neighbor_price": o.get("neighbor_price"),
            })
        return sorted(out, key=lambda t: t["at"])

    def period(self, period: str = "today", now: float | None = None) -> dict:
        label, start, end = _range(period, now)
        mins = self.minutes(start, end)
        trades = self.trades(start, end)
        out = settle_period(mins, self.weights, prices(), trades)
        blob = json.dumps(sorted(x for r in mins for x in r["sigs"]))
        with self._lock:
            row = self._db.execute("SELECT chain FROM settled WHERE period = ?", (label,)).fetchone()
        return {"enabled": True, "period": label, "from": start, "to": end, "minutes": len(mins), **out,
                "trades": trades, "readings_hash": "0x" + hashlib.sha256(blob.encode()).hexdigest(),
                "chain": self.chain(label, json.loads(row[0]) if row else None)}

    def chain(self, key: str, saved: dict | None) -> dict | None:
        """chain{} for a period: what SolarCredits says now (claims change after settling), read at
        most every 20 s, else what settle saved. Only for periods this Pi settled."""
        arc = self.arc
        if not saved or not (arc and getattr(arc, "enabled", False) and getattr(arc, "credits", None) is not None
                             and hasattr(arc, "credits_settle") and hasattr(arc, "credits_status")):
            return saved
        hit = self._status.get(key)
        if not hit or time.time() - hit[0] > 20:
            try:
                hit = (time.time(), arc.credits_status(key))
                self._status[key] = hit
            except Exception as e:
                log.info("SolarCredits status for %s failed: %s", key, str(e)[:120])
                return saved
        return {**saved, **{k: v for k, v in hit[1].items() if v is not None}}

    def window(self, minutes: int = 15, now: float | None = None) -> dict:
        """The last few minutes, for the 0G trader (pi/trader.py TradeLoop calls this as its
        snapshot, with minutes = its own interval): how much is spare and who needs more."""
        end = int((now or time.time()) // 60 * 60)
        start = end - minutes * 60
        out = settle_period(self.minutes(start, end), self.weights, prices())
        p = prices()
        return {"since": start, "until": end, "window": [start, end], "spare_wh": out["spare_wh"],
                "needs": {f: x["over_wh"] for f, x in out["flats"].items() if x["over_wh"] > 0},
                "unused": {f: x["unused_wh"] for f, x in out["flats"].items()},
                "shop_order_wh": self.shop_order_wh(now),
                "prices": {"export": p["export"], "import": p["import"], "neighbor_default": p["neighbor"], "shop": p["shop"]}}

    def shop_order_wh(self, now: float | None = None) -> float:
        """What the shop still wants today (model Wh): its open ShopTrade orders (want_wh is real Wh)
        minus what 0G already routed to the shop today, plus any standing SHOP_DEMAND_WH."""
        day = datetime.fromtimestamp(now or time.time()).strftime("%Y-%m-%d")
        want = 0.0
        for o in list(getattr(self.sales, "orders", {}).values()):
            if o.get("status") == "open" and o.get("day") == day:
                want += float(o.get("want_wh") or 0) / _f("BILL_SCALE", 1000)
        _, start, end = _range(day)
        routed = sum(float(r.get("wh") or 0) for t in self.trades(start, end) if t.get("mode") == "ai"
                     for r in t["routes"] if r.get("to") == "shop")
        return round(max(0.0, want - routed) + SHOP_DEMAND_WH, 4)

    # ---- on chain (SolarCredits, helpers in arc.py) ----------------------------------------
    def settle(self, arc, period: str = "today") -> dict:
        """Post a period (a day, or a month) to SolarCredits and fund it with the shop + grid
        revenue, through arc.py's credits_settle (dy-arc: it posts once and funds only what is
        missing, so settling twice is safe). Neighbours pay in themselves (payIn); flats claim."""
        if not hasattr(arc, "credits_settle") and not all(hasattr(arc, f) for f in ("post_credits", "fund_credits")):
            raise RuntimeError("SolarCredits helpers are not in this build (arc.credits_settle)")
        if not getattr(arc, "enabled", False) or getattr(arc, "credits", None) is None:
            raise RuntimeError("SolarCredits is not set up on this Pi (ARC_PRIVATE_KEY and ARC_CREDITS)")
        p = self.period(period)
        k = p["scale"]["real_kwh_per_wh"]
        neighbours_usdc = sum(x["over_wh"] for x in p["flats"].values()) * k * p["pool"]["prices"]["neighbor"]
        fund_usdc = round(max(0.0, p["pool"]["revenue_usdc"] - neighbours_usdc), 6)  # shop + grid
        if hasattr(arc, "credits_settle"):
            flats = {f: x for f, x in p["flats"].items() if self.weights.get(f, 0) > 0}
            chain = arc.credits_settle(p["period"], flats, p["pool"]["prices"]["neighbor"], fund_usdc, p["readings_hash"])
        else:  # the earlier, lower-level helpers
            if p["chain"] and p["chain"].get("post_tx"):
                return p["chain"]
            pid = hashlib.sha256(f"dynaura-credits:{p['period']}".encode()).digest()
            scale = _f("BILL_SCALE", 1000)
            flats = [f for f in FLATS if self.weights.get(f, 0) > 0]
            post_tx = arc.post_credits(pid, flats, [int(round(p["flats"][f]["unused_wh"] * scale)) for f in flats],
                                       [int(round(p["flats"][f]["over_wh"] * scale)) for f in flats],
                                       int(round(p["pool"]["prices"]["neighbor"] * 1e6)), bytes.fromhex(p["readings_hash"][2:]))
            amount = int(round(fund_usdc * 1e6))
            chain = {"period_id": "0x" + pid.hex(), "post_tx": post_tx,
                     "fund_tx": arc.fund_credits(pid, amount) if amount > 0 else None,
                     "claims": arc.credit_claims(pid) if hasattr(arc, "credit_claims") else {f: None for f in flats}}
        chain = {**chain, "fund_usdc": fund_usdc, "settled_at": int(time.time())}
        with self._lock:
            self._db.execute("INSERT OR REPLACE INTO settled (period, chain) VALUES (?, ?)", (p["period"], json.dumps(chain)))
        self._status.pop(p["period"], None)
        if len(p["period"]) == 10:  # a day: its Arkiv record gets the period id and post tx
            self.post_period(p["period"])
        return chain

    # ---- Arkiv -------------------------------------------------------------------------
    def arkiv_body(self, p: dict) -> dict:
        return {"day": p["period"], "available_wh": p["available_wh"], "common_wh": p["common_wh"], "spare_wh": p["spare_wh"],
                **{k: p["pool"][k] for k in ("neighbor_wh", "shop_wh", "grid_wh", "revenue_usdc", "prices")},
                "flats": {f: {k: v for k, v in x.items() if k != "weight"} for f, x in p["flats"].items()},
                "trade_ids": [t["request_id"] for t in p["trades"] if t.get("request_id")],
                "readings_hash": p["readings_hash"],
                **({"period_id": p["chain"]["period_id"], "post_tx": p["chain"].get("post_tx")} if p.get("chain") else {})}

    def post_period(self, day: str | None = None) -> None:
        if self.arkiv:
            self.arkiv.post("/credit_period", self.arkiv_body(self.period(day or "today")))

    def post_new_trades(self) -> int:
        """Each 0G trade decision becomes a dynaura.trade entity on Arkiv (once)."""
        if not self.arkiv:
            return 0
        with self._lock:
            row = self._db.execute("SELECT value FROM posted WHERE what = 'trade'").fetchone()
        last = row[0] if row else 0
        new = sorted((d for d in self.store.decisions("trade", 200) if d["id"] > last), key=lambda d: d["id"])
        for d in new:
            o = d.get("output") or {}
            self.arkiv.post("/trade", {"decision_id": d["id"], "at": int(d["ts"]), "mode": d["mode"],
                                       "og_request_id": d.get("request_id"), "spare_wh": o.get("spare_wh"),
                                       "neighbor_price": o.get("neighbor_price"), "routes": o.get("routes") or [],
                                       "reason": o.get("reason") or d.get("summary") or ""})
            with self._lock:
                self._db.execute("INSERT OR REPLACE INTO posted (what, value) VALUES ('trade', ?)", (d["id"],))
        return len(new)

    # ---- threads -----------------------------------------------------------------------
    def _run(self) -> None:
        last, last_post, last_trades = time.monotonic(), 0.0, 0.0
        while not self._stop.wait(SAMPLE_S):
            now = time.monotonic()
            try:
                self.sample(min(now - last, 3 * SAMPLE_S))
            except Exception:
                log.exception("credits sample failed")
            last = now
            try:
                if time.time() - last_trades > 30:  # a new 0G trade reaches Arkiv within ~30 s
                    last_trades = time.time()
                    self.post_new_trades()
                if time.time() - last_post > ARKIV_EVERY_S:
                    last_post = time.time()
                    self.post_period()
            except Exception:
                log.exception("credits to Arkiv failed")

    def start(self) -> None:
        threading.Thread(target=self._run, name="credits", daemon=True).start()

    def stop(self) -> None:
        self._stop.set()
