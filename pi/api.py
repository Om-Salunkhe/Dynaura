"""Pi API for the web app.

Run from the pi/ folder:  python api.py
Then open http://<pi>:8000/api/state
"""
import asyncio
import atexit
import json
import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse

import billing
import config
import credits
import dyna
import zg
from arc import Arc, ArcUnavailable
from arkiv import ArkivQueue
from brain import Brain, PlanBusy
from cleaning import CleaningWatch, DustCheckMissing
from hw import FLATS, load_hardware
from jobs import JobRunner, PlanScheduler
from meter import MeterLoop
from sales import ShopSettler
from og_storage import Uploader
from zg_registry import Registry
from signer import DeviceSigner
from spare import SparePump
from store import Store

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("dynaura.api")


class App:
    hw = None
    store = None
    signer = None
    loop = None
    brain = None
    runner = None
    uploader = None
    arkiv = None
    scheduler = None
    arc = None
    cleaning = None
    sales = None
    credits = None  # fair-share ledger (credits.py), None when CREDITS_ENABLED=false
    trader = None  # 0G trade loop (trader.py), routes each window's spare sun
    spare = None   # 0G runs the tank pump on spare sun when flats are away (spare.py)


@asynccontextmanager
async def lifespan(_: FastAPI):
    App.hw = load_hardware(config.HW)
    App.hw.safe_stop()                  # start from a known state: everything on grid
    atexit.register(App.hw.safe_stop)   # last line of defence if the process dies
    App.store = Store(config.DB_PATH)
    App.signer = DeviceSigner(config.DEVICE_PRIVATE_KEY)
    App.loop = MeterLoop(App.hw, App.store, App.signer)
    App.loop.tick()
    App.loop.start()
    App.uploader = Uploader(App.store, registry=Registry())
    # Each episode log also records what the building looked like when Dyna decided
    App.uploader.snapshot = lambda: {**App.loop.state, "runner": App.runner.status if App.runner else None}
    App.brain = Brain(App.hw, App.store, App.uploader)
    App.spare = SparePump(App.hw, App.loop, store=App.store, uploader=App.uploader, notify=App.brain.notify)
    App.runner = JobRunner(App.hw, App.loop, App.brain, spare=App.spare)
    App.runner.start()
    if config.ARKIV_ENABLED:
        App.arkiv = ArkivQueue(App.store, App.loop, App.runner)
        App.loop.on_summary(App.arkiv.on_summaries)
        # Each decision goes to Arkiv once: after its 0G Storage upload (with the root),
        # or straight away when 0G Storage is not set up.
        App.brain.on_decision = lambda did: None if App.uploader.ready() else App.arkiv.decision(did)
        App.uploader.on_root = lambda did, root: App.arkiv.decision(did)
        App.brain.arkiv = App.arkiv
        App.arkiv.start()
    App.arc = Arc()
    App.cleaning = CleaningWatch(App.hw, App.loop, App.store, App.arc, App.brain,
                                 capture=dust_camera(), check_dust=getattr(zg, "check_dust", None))
    if App.arkiv:
        App.cleaning.on_job = on_cleaning_job
    App.cleaning.start()
    App.sales = ShopSettler(App.arc, App.brain, App.cleaning)
    if App.arkiv:
        App.sales.on_offer = lambda offer: App.arkiv.post("/offer", offer)
        App.sales.on_sale = lambda sale: App.arkiv.post("/sale", sale)
    App.brain.on_offer = App.sales.publish_plan_offer
    App.sales.start()
    App.scheduler = PlanScheduler(App.brain)
    App.scheduler.start()
    if credits.ENABLED:  # fair share + solar credits (dy-arkiv); off = no change
        App.credits = credits.Ledger(App.store, App.hw, App.arkiv, sales=App.sales, arc=App.arc)
        App.credits.live_minute = App.loop.partial
        App.sales.routed = lambda order: App.credits.routed_shop_wh(
            order["day"], since=order.get("detected_at"), until=order.get("deadline"))
        App.credits.start()
        try:  # the 0G trader (dy-0g) routes each window's spare; without trader.py, no trades
            import trader
            App.trader = _trade_loop(trader)
            App.trader.start()
        except (ImportError, AttributeError) as e:
            log.info("no 0G trade loop (%s): the spare counts as grid export", e)
    log.info("Dynaura up: hw=%s device=%s", config.HW, App.signer.address)
    try:
        yield
    finally:
        if App.trader:
            App.trader.stop()
        if App.credits:
            App.credits.stop()
        if App.arkiv:
            App.arkiv.stop()
        App.scheduler.stop()
        App.cleaning.stop()
        App.sales.stop()
        App.runner.stop()
        App.loop.stop()
        App.loop.safe_stop("api shutting down")
        App.hw.close()
        App.store.close()


def dust_camera():
    """The panel camera (pi/camera.py): capture(hw) -> JPEG. None until it is installed."""
    try:
        import camera
        return camera.capture
    except ImportError:
        log.warning("pi/camera.py not found: the panel can't be scanned yet")
        return None


def on_cleaning_job(job: dict) -> None:
    """Every step of a cleaning request goes to Arkiv as the job dict itself (one entity per request,
    patched as it moves; the bridge replies with its key). A paid job also becomes a maintenance record."""
    og, arc = job.get("og") or {}, job.get("arc") or {}
    body = {k: v for k, v in job.items() if k not in ("status", "job_id")}  # drop the aliases for older screens
    body["_on_reply"] = lambda out: App.cleaning.set_arkiv_key(job["id"], out.get("key"))
    App.arkiv.post("/cleaning_job", body)
    if job["state"] == "paid":
        App.arkiv.post("/maintenance", {
            "title": "Panel cleaned",
            "details": f"0G saw dust ({og.get('coverage_pct')}% covered, request {og.get('request_id')}). "
                       f"Output {job.get('dusty_pct') or 0:.0f}% -> {job.get('after_pct') or 0:.0f}%. "
                       f"Paid {job['fee_usdc']:.2f} USDC to {job.get('cleaner')} from Arc escrow #{arc.get('job_id')}.",
            "arc_tx": arc.get("release_tx"),
        })


app = FastAPI(title="Dynaura Pi API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/api/health")
def health():
    arkiv = {"enabled": bool(App.arkiv), "ok": App.arkiv.ok if App.arkiv else None,
             "error": App.arkiv.last_error if App.arkiv else None}
    arc = {"enabled": App.arc.enabled, "wallet": App.arc.address if App.arc.enabled else None}
    return {"ok": True, "hw": config.HW, "device": App.signer.address, "arkiv": arkiv, "arc": arc,
            "zg_storage_ready": App.uploader.ready() if App.uploader else False,
            "zg_storage": App.uploader.status() if App.uploader else None}


@app.get("/api/episodes")
def episodes():
    """The 0G Storage queue: how many episode logs wait for 0G (e.g. while it is offline)."""
    return App.uploader.status()


@app.post("/api/admin/episodes/retry")
def retry_episodes(x_admin_key: str | None = Header(default=None)):
    """Upload the waiting episode logs now (demo: right after the internet is back)."""
    require_admin(x_admin_key)
    return App.uploader.retry_now()


def live() -> dict:
    return {**App.loop.state, "runner": App.runner.status, "cleaning": App.cleaning.status,
            "spare_pump": App.spare.status() if App.spare else None}


@app.get("/api/state")
def state():
    return live()


@app.get("/api/stream")
async def stream(request: Request):
    """Server-Sent Events: the live state once a second.
    In the browser: new EventSource("http://<pi>:8000/api/stream")"""

    async def events():
        last_ts = None
        while not await request.is_disconnected():
            st = App.loop.state
            if st and st.get("ts") != last_ts:
                last_ts = st["ts"]
                yield f"data: {json.dumps(live())}\n\n"
            await asyncio.sleep(0.5)

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/summaries")
def summaries(meter: str | None = None, since: int = 0, limit: int = 60):
    return App.store.summaries(meter=meter, since=since, limit=min(limit, 1440))



def require_admin(key: str | None) -> None:
    if not config.ADMIN_KEY or key != config.ADMIN_KEY:
        raise HTTPException(status_code=403, detail="admin key required (X-Admin-Key)")


@app.get("/api/plan")
def get_plan():
    return {**App.brain.public(), "runner": App.runner.status}


@app.post("/api/plan/run")
def run_plan(which: str = "today", x_admin_key: str | None = Header(default=None)):
    require_admin(x_admin_key)
    try:
        return App.brain.run_plan("tomorrow" if which == "tomorrow" else "today", wait=False)
    except PlanBusy:  # e.g. the start-up plan is still waiting for 0G
        raise HTTPException(status_code=409, detail="a plan is already being made; try again when it is done")


@app.post("/api/admin/jobs")
def edit_job(body: dict, x_admin_key: str | None = Header(default=None)):
    """Admin moves a society job: {"id": "pool", "start": "11:30", "minutes": 60}"""
    require_admin(x_admin_key)
    plan = App.brain.plan
    if not plan:
        raise HTTPException(status_code=409, detail="no plan yet")
    for j in plan["jobs"]:
        if j["id"] == body.get("id"):
            if body.get("start"):
                j["start"] = str(body["start"])[:5]
            if body.get("minutes"):
                j["minutes"] = int(body["minutes"])
            j["why"] = "Changed by committee admin"
            plan["jobs"].sort(key=lambda x: x["start"])
            return App.brain.public()
    raise HTTPException(status_code=404, detail="job not in plan")


@app.post("/api/admin/maintenance")
def add_maintenance(body: dict, x_admin_key: str | None = Header(default=None)):
    """Admin adds a maintenance record: {"title": "...", "details": "..."} -> Arkiv"""
    require_admin(x_admin_key)
    if not App.arkiv:
        raise HTTPException(status_code=503, detail="Arkiv is disabled")
    try:
        return App.arkiv.send_now("/maintenance", {"title": body.get("title"), "details": body.get("details")})
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Arkiv write failed: {e}")


@app.post("/api/admin/price")
def set_price(body: dict, x_admin_key: str | None = Header(default=None)):
    """Admin sets the shop price: {"price_usdc": 0.08}"""
    require_admin(x_admin_key)
    App.brain.price = max(0.0, float(body.get("price_usdc", config.SHOP_PRICE_USDC)))
    # All live pricing reads this value.  Retire any already-advertised offer so the next
    # measured-spare trade is published at the same price the Arc contract will charge.
    config.SHOP_PRICE_USDC = App.brain.price
    App.sales.offer = None
    out = {"price_usdc": App.brain.price}
    if App.arc.enabled and App.arc.shop:  # the on-chain price is what shops actually pay
        try:
            out["arc_tx"] = App.arc.set_price(App.brain.price)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"price saved on the Pi, Arc update failed: {e}")
    return out


@app.get("/api/cleaning")
def cleaning():
    """{job, history, ...}: the cleaning request in progress (see pi/cleaning.py for the states)."""
    return App.cleaning.status


@app.get("/api/camera/latest.jpg")
def camera_latest():
    """The last frame the Pi looked at (the one 0G judged)."""
    if not App.cleaning.frame:
        raise HTTPException(status_code=404, detail="no frame yet: scan the panel first")
    return Response(content=App.cleaning.frame, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


def _cleaning_call(fn, *args):
    try:
        return fn(*args)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ArcUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Arc transaction failed: {e}")


@app.post("/api/admin/cleaning/scan")
def scan_panel(x_admin_key: str | None = Header(default=None)):
    """Take a frame and let 0G judge it now: {job} (flagged) or {dirty: false, og}. 503 when 0G is unreachable."""
    require_admin(x_admin_key)
    try:
        return App.cleaning.scan("admin")
    except zg.ZGUnavailable as e:
        return JSONResponse(status_code=503, content={"error": "0G unreachable", "detail": str(e)[:300]})
    except DustCheckMissing as e:
        return JSONResponse(status_code=503, content={"error": "dust check not installed", "detail": str(e)})


@app.post("/api/admin/cleaning")
def post_cleaning(x_admin_key: str | None = Header(default=None)):
    """Older screens: same as Scan panel (no money moves before the admin approves)."""
    return scan_panel(x_admin_key)


@app.post("/api/admin/cleaning/approve")
def approve_cleaning(body: dict | None = None, x_admin_key: str | None = Header(default=None)):
    """Approve the flagged request: {"fee_usdc": 2} (optional) -> the Pi locks the fee in the Arc escrow."""
    require_admin(x_admin_key)
    fee = (body or {}).get("fee_usdc")
    return _cleaning_call(App.cleaning.approve, float(fee) if fee is not None else None)


@app.post("/api/admin/cleaning/reject")
def reject_cleaning(x_admin_key: str | None = Header(default=None)):
    """Dismiss the flagged request. No money moved."""
    require_admin(x_admin_key)
    return _cleaning_call(App.cleaning.reject)


@app.post("/api/cleaning/done")
def cleaning_done():
    """The cleaner's "Mark done" (not a transaction): the meter checks the panel for a minute."""
    return _cleaning_call(App.cleaning.mark_done)


@app.get("/api/sales")
def sales():
    return App.sales.status


@app.post("/api/admin/settle/{order_id}")
def settle_now(order_id: int, x_admin_key: str | None = Header(default=None)):
    """Settle a shop order now instead of waiting for its delivery deadline."""
    require_admin(x_admin_key)
    try:
        return App.sales.settle(order_id)
    except ArcUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Arc transaction failed: {e}")


@app.get("/api/bill")
def get_bill(flat: str = "A", month: str | None = None):
    """This month's bill for one flat, and whether it is posted / paid on Arc."""
    if flat not in FLATS:
        raise HTTPException(status_code=400, detail="flat must be A, B or C")
    b = billing.compute(App.store, flat, month)
    try:
        return billing.with_chain(App.arc, b)
    except Exception as e:
        return {**billing.public(b), "arc_error": str(e)[:200]}


@app.post("/api/admin/bills")
def post_bills(body: dict | None = None, x_admin_key: str | None = Header(default=None)):
    """Post every flat's bill on Arc: {"month": "2026-11"} (default this month)"""
    require_admin(x_admin_key)

    def to_arkiv(row):
        if App.arkiv:
            App.arkiv.post("/bill", {"flat": row["flat"], "month": row["month"], "kwh": row["solar_kwh"] + row["grid_kwh"],
                                     "solar_pct": row["solar_pct"], "usdc": row["usdc"], "arc_tx": row["arc_tx"]})
    try:
        return billing.post_all(App.store, App.arc, (body or {}).get("month"), on_bill=to_arkiv)
    except ArcUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Arc transaction failed: {e}")


@app.post("/api/ask")
def ask(body: dict):
    """Ask Dyna: {"question": "...", "flat": "A"}"""
    flat = body.get("flat") if body.get("flat") in FLATS else "A"
    question = str(body.get("question", "")).strip()
    if not question:
        raise HTTPException(status_code=400, detail="question is empty")
    try:
        out = dyna.ask(App.store, App.brain, flat, question)
        App.uploader.enqueue(out["decision_id"])
        App.brain.notify(out["decision_id"])
        return out
    except zg.ZGUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))


@app.get("/api/decisions")
def decisions(kind: str | None = None, limit: int = 20):
    rows = App.store.decisions(kind, min(limit, 100))
    for r in rows:
        r.pop("input", None)
    return rows


# ---- fair share + solar credits (pi/credits.py) ---------------------------------------------
def _trade_loop(trader, minutes: float | None = None, include_now: bool = False):
    """A TradeLoop whose snapshot is the ledger's window. The window matches the loop's interval
    (so no spare is routed twice); a one-off run may ask for a longer window, and include the
    minute in progress (the demo's "sell now": half a minute of lamp is already spare)."""
    loop = trader.TradeLoop(None, store=App.store, uploader=App.uploader, notify=App.brain.notify)
    win = minutes or max(1, round(loop.interval_s / 60))
    loop.snapshot = lambda: App.credits.window(max(1, int(win)), include_now=include_now)
    loop.on_trade = lambda trade, snap: App.sales.offer_from_trade(trade, snap)
    return loop


@app.get("/api/credits")
def get_credits(period: str = "today"):
    """period = today | month | YYYY-MM-DD. Each flat's share, use, unused sun and what it earned."""
    if not App.credits:
        return {"enabled": False}
    try:
        return App.credits.period(period)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/marketplace")
def marketplace():
    """The real market: current metered/0G offer, prepaid Arc orders and settled sales."""
    return {**App.sales.status, "trader": App.trader.status() if App.trader else None}


@app.post("/api/admin/credits/trade")
def trade_credits(body: dict | None = None, x_admin_key: str | None = Header(default=None)):
    """Demo: ask 0G now where the last window's spare sun goes (body {minutes}, default TRADE_EVERY_MIN)."""
    require_admin(x_admin_key)
    if not App.credits:
        raise HTTPException(status_code=404, detail="credits are off (CREDITS_ENABLED=false)")
    if not App.trader:
        raise HTTPException(status_code=503, detail="the 0G trader (pi/trader.py) is not in this build")
    import trader
    body = body or {}
    return _trade_loop(trader, float(body.get("minutes") or trader.TRADE_EVERY_MIN),
                       include_now=bool(body.get("include_now", True))).run_now()


@app.post("/api/admin/credits/settle")
def settle_credits(body: dict | None = None, x_admin_key: str | None = Header(default=None)):
    """Post a period (body {period}: today, YYYY-MM-DD or YYYY-MM) to SolarCredits on Arc and fund it
    with the shop + grid revenue. Safe to call twice."""
    require_admin(x_admin_key)
    if not App.credits:
        raise HTTPException(status_code=404, detail="credits are off (CREDITS_ENABLED=false)")
    try:
        return App.credits.settle(App.arc, (body or {}).get("period", "today"))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (RuntimeError, ArcUnavailable) as e:
        raise HTTPException(status_code=503, detail=str(e))


@app.get("/api/spare")
def spare_status():
    """Scenario 2: the last time 0G decided whether the tank pump runs on spare sun."""
    return App.spare.status() if App.spare else {"enabled": False}


@app.post("/api/admin/spare/check")
def spare_check(x_admin_key: str | None = Header(default=None)):
    """Demo: ask 0G now whether the tank pump should run on the spare sun (flats away)."""
    require_admin(x_admin_key)
    return App.spare.check_now()


@app.post("/api/moment/{name}")
def moment(name: str, x_admin_key: str | None = Header(default=None)):
    """Demo buttons: cloud, sun, dust, clean, light-A, heavy-B, normal (SIM only), away-A/B/C, home-A/B/C, pump."""
    require_admin(x_admin_key)
    if name == "pump":
        App.runner.run_pump_now()
    elif name.startswith(("away-", "home-")) and name[-1] in FLATS and hasattr(App.hw, "set_away"):
        App.hw.set_away(name[-1], name.startswith("away-"))
    elif hasattr(App.hw, "set_moment"):
        try:
            App.hw.set_moment(name)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    else:
        raise HTTPException(status_code=400, detail=f"moment {name!r} not available on real hardware")
    return {"ok": True, "moment": name}


if __name__ == "__main__":
    uvicorn.run(app, host=config.API_HOST, port=config.API_PORT)
