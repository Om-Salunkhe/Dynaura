"""Settings from the .env file at the repo root."""
import os
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

HW = os.getenv("DYNAURA_HW", "sim")
SIM_SPEED = float(os.getenv("SIM_SPEED", "1") or 1)


def _sim_start():
    """SIM_START=HH:MM starts the simulated day at that time today (handy at night)."""
    raw = os.getenv("SIM_START", "").strip()
    if not raw:
        return None
    h, m = (int(x) for x in raw.split(":"))
    return datetime.now().replace(hour=h, minute=m, second=0, microsecond=0)


SIM_START = _sim_start()
API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("API_PORT", "8000") or 8000)
DB_PATH = os.getenv("DB_PATH", "dynaura.db")
DEVICE_PRIVATE_KEY = os.getenv("DEVICE_PRIVATE_KEY", "").strip()
