"""Monthly bill per flat, split by what each flat's own meter measured.

solar kWh x SOLAR_RATE + grid kWh x GRID_RATE, in USDC. The model building is tiny, so readings are
scaled by BILL_SCALE (default 1000: 1 Wh on the model = 1 kWh in the real building).
The Pi keeps 7 days of signed summaries, so a bill covers what is on the Pi for that month.
"""
import hashlib
import json
import time
from datetime import datetime

import config
from hw import FLATS


def month_range(month: str) -> tuple[int, int]:
    start = datetime.strptime(month + "-01", "%Y-%m-%d")
    end = start.replace(year=start.year + 1, month=1) if start.month == 12 else start.replace(month=start.month + 1)
    return int(start.timestamp()), int(end.timestamp())


def compute(store, flat: str, month: str | None = None) -> dict:
    month = month or datetime.now().strftime("%Y-%m")
    start, end = month_range(month)
    rows = [r for r in store.summaries(meter=flat, since=start, limit=60 * 24 * 31) if r["minute"] < end]
    wh = sum(r["wh"] for r in rows) * config.BILL_SCALE
    solar = sum(r["solar_wh"] for r in rows) * config.BILL_SCALE
    grid = max(0.0, wh - solar)
    usdc = round(solar / 1000 * config.SOLAR_RATE_USDC + grid / 1000 * config.GRID_RATE_USDC, 2)
    blob = json.dumps(sorted((r["minute"], r.get("sig")) for r in rows))
    return {
        "flat": flat, "month": month, "minutes": len(rows),
        "solar_kwh": round(solar / 1000, 2), "grid_kwh": round(grid / 1000, 2),
        "solar_pct": round(100 * solar / wh) if wh else 0,
        "usdc": usdc, "solar_rate": config.SOLAR_RATE_USDC, "grid_rate": config.GRID_RATE_USDC,
        "saved_usdc": round(solar / 1000 * (config.GRID_RATE_USDC - config.SOLAR_RATE_USDC), 2),
        "readings_hash": hashlib.sha256(blob.encode()).digest(),
    }


def public(bill: dict) -> dict:
    return {**bill, "readings_hash": "0x" + bill["readings_hash"].hex(), "bill_id": 0, "paid": False, "arc": False}


def with_chain(arc, bill: dict) -> dict:
    """Add the on-chain state (bill id, paid) when SolarBilling is set up."""
    out = public(bill)
    if arc.enabled and arc.billing:
        out["arc"] = True
        bid = arc.bill_id(bill["flat"], bill["month"])
        if bid:
            chain = arc.bill(bid)
            out.update(bill_id=bid, paid=chain["paid"], paid_by=chain["paid_by"], posted_usdc=chain["usdc"])
    return out


def post_all(store, arc, month: str | None = None, on_bill=None) -> list[dict]:
    """Post every flat's bill for the month on Arc (once per flat and month)."""
    month = month or datetime.now().strftime("%Y-%m")
    out = []
    for f in FLATS:
        b = compute(store, f, month)
        if arc.bill_id(f, month):
            out.append({**with_chain(arc, b), "skipped": "already posted"})
            continue
        bid, tx = arc.post_bill(f, month, config.FLAT_WALLETS.get(f), b["usdc"],
                                int(b["solar_kwh"] * 1000), int(b["grid_kwh"] * 1000), b["readings_hash"])
        row = {**with_chain(arc, b), "arc_tx": tx, "posted_at": int(time.time())}
        out.append(row)
        if on_bill:
            on_bill(row)
    return out
