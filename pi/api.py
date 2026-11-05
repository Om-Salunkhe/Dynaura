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
from fastapi.responses import StreamingResponse

import config
import dyna
import zg
from arkiv import ArkivQueue
from brain import Brain
from hw import FLATS, load_hardware
from jobs import JobRunner, PlanScheduler
from meter import MeterLoop
from og_storage import Uploader
from signer import DeviceSigner
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
    App.uploader = Uploader(App.store)
    App.brain = Brain(App.hw, App.store, App.uploader)
    App.runner = JobRunner(App.hw, App.loop, App.brain)
    App.runner.start()
    if config.ARKIV_ENABLED:
        App.arkiv = ArkivQueue(App.store, App.loop, App.runner)
        App.loop.on_summary(App.arkiv.on_summaries)
        # Each decision goes to Arkiv once: after its 0G Storage upload (with the root),
        # or straight away when 0G Storage is not set up.
        App.brain.on_decision = lambda did: None if App.uploader.ready() else App.arkiv.decision(did)
        App.uploader.on_root = lambda did, root: App.arkiv.decision(did)
        App.arkiv.start()
    App.scheduler = PlanScheduler(App.brain)
    App.scheduler.start()
    log.info("Dynaura up: hw=%s device=%s", config.HW, App.signer.address)
    try:
        yield
    finally:
        if App.arkiv:
            App.arkiv.stop()
        App.scheduler.stop()
        App.runner.stop()
        App.loop.stop()
        App.loop.safe_stop("api shutting down")
        App.hw.close()
        App.store.close()


app = FastAPI(title="Dynaura Pi API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/api/health")
def health():
    arkiv = {"enabled": bool(App.arkiv), "ok": App.arkiv.ok if App.arkiv else None,
             "error": App.arkiv.last_error if App.arkiv else None}
    return {"ok": True, "hw": config.HW, "device": App.signer.address, "arkiv": arkiv,
            "zg_storage_ready": App.uploader.ready() if App.uploader else False}


@app.get("/api/state")
def state():
    return {**App.loop.state, "runner": App.runner.status}


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
                yield f"data: {json.dumps({**st, 'runner': App.runner.status})}\n\n"
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
    return App.brain.run_plan("tomorrow" if which == "tomorrow" else "today")


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


@app.post("/api/moment/{name}")
def moment(name: str, x_admin_key: str | None = Header(default=None)):
    """Demo buttons: cloud, sun, dust, clean (SIM only), away-A/B/C, home-A/B/C, pump."""
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
