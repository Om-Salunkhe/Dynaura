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

# Location for the sun forecast (default: Mumbai)
LAT = float(os.getenv("LAT", "19.07") or 19.07)
LON = float(os.getenv("LON", "72.88") or 72.88)
TIMEZONE = os.getenv("TIMEZONE", "Asia/Kolkata")
# Real rooftop size the demo stands for, used to show building-scale kWh in the app
BUILDING_KWP = float(os.getenv("BUILDING_KWP", "2.0") or 2.0)

# 0G Compute Router (OpenAI-compatible). Testnet: https://router-api-testnet.integratenetwork.work/v1
ZG_ROUTER_URL = os.getenv("ZG_ROUTER_URL", "").strip()
ZG_API_KEY = os.getenv("ZG_API_KEY", "").strip()
ZG_MODEL = os.getenv("ZG_MODEL", "0gm-1.0-35b-a3b").strip()

# Society job runner
PLAN_HOUR = int(os.getenv("PLAN_HOUR", "20") or 20)          # make tomorrow's plan at 8 PM
SOLAR_MIN_W = float(os.getenv("SOLAR_MIN_W", "0.3") or 0.3)  # panel must give at least this to switch flats to solar
PUMP_SECONDS = float(os.getenv("PUMP_SECONDS", "8") or 8)    # model pump has no float switch: fixed run time
IGNORE_CLOCK = os.getenv("IGNORE_CLOCK", "false").lower() == "true"  # demo under a lamp at night: ignore plan hours
ADMIN_KEY = os.getenv("ADMIN_KEY", "").strip()               # needed for admin changes from the web app

# 0G Storage (Go CLI from github.com/0glabs/0g-storage-client)
ZG_STORAGE_CLI = os.getenv("ZG_STORAGE_CLI", "0g-storage-client").strip()
ZG_RPC = os.getenv("ZG_RPC", "https://evmrpc-testnet.0g.ai").strip()
ZG_INDEXER = os.getenv("ZG_INDEXER", "https://indexer-storage-testnet-turbo.0g.ai").strip()
ZG_PRIVATE_KEY = os.getenv("ZG_PRIVATE_KEY", "").strip()

# Arkiv bridge (bridge/bridge.mjs)
ARKIV_BRIDGE_URL = os.getenv("ARKIV_BRIDGE_URL", "http://127.0.0.1:5100").strip()
ARKIV_ENABLED = os.getenv("ARKIV_ENABLED", "true").lower() == "true"
