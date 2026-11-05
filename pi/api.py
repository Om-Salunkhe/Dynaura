"""Pi API for the web app.

Run from the pi/ folder:  python api.py
Then open http://<pi>:8000/api/state
"""
import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import config
from hw import load_hardware
from meter import MeterLoop
from signer import DeviceSigner
from store import Store

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("dynaura.api")


class App:
    hw = None
    store = None
    signer = None
    loop = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    App.hw = load_hardware(config.HW)
    App.store = Store(config.DB_PATH)
    App.signer = DeviceSigner(config.DEVICE_PRIVATE_KEY)
    App.loop = MeterLoop(App.hw, App.store, App.signer)
    App.loop.tick()
    App.loop.start()
    log.info("Dynaura up: hw=%s device=%s", config.HW, App.signer.address)
    yield
    App.loop.stop()
    App.store.close()


app = FastAPI(title="Dynaura Pi API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/api/health")
def health():
    return {"ok": True, "hw": config.HW, "device": App.signer.address}


@app.get("/api/state")
def state():
    return App.loop.state


@app.get("/api/summaries")
def summaries(meter: str | None = None, since: int = 0, limit: int = 60):
    return App.store.summaries(meter=meter, since=since, limit=min(limit, 1440))


if __name__ == "__main__":
    uvicorn.run(app, host=config.API_HOST, port=config.API_PORT)
