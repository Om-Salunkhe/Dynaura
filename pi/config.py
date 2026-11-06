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
# Longest wait for an answer (connecting gives up after 5 s), and no automatic retry: if 0G fails,
# the building goes to its safe stop instead of waiting. Tune ZG_TIMEOUT_S to the measured latency.
ZG_TIMEOUT_S = float(os.getenv("ZG_TIMEOUT_S", "30") or 30)
ZG_MAX_RETRIES = int(os.getenv("ZG_MAX_RETRIES", "0") or 0)

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
# EpisodeRegistry on 0G Chain (zerog/deployments.json). The ZG_PRIVATE_KEY wallet must be its device.
ZG_REGISTRY = os.getenv("ZG_REGISTRY", "").strip()
ZG_CHAIN_ID = int(os.getenv("ZG_CHAIN_ID", "16602") or 16602)

# Arkiv bridge (bridge/bridge.mjs)
ARKIV_BRIDGE_URL = os.getenv("ARKIV_BRIDGE_URL", "http://127.0.0.1:5100").strip()
ARKIV_ENABLED = os.getenv("ARKIV_ENABLED", "true").lower() == "true"

# Price for spare solar sold to nearby shops (USDC per kWh); the admin can change it in the app
SHOP_PRICE_USDC = float(os.getenv("SHOP_PRICE_USDC", "0.08") or 0.08)

# Arc testnet (contracts deployed from Arc Studio, see contracts/README.md)
ARC_RPC_URL = os.getenv("ARC_RPC_URL", "https://rpc.testnet.arc.io").strip()
ARC_CHAIN_ID = int(os.getenv("ARC_CHAIN_ID", "5042002") or 5042002)
ARC_PRIVATE_KEY = os.getenv("ARC_PRIVATE_KEY", "").strip()   # Pi wallet = oracle of the contracts
ARC_USDC = os.getenv("ARC_USDC", "0x3600000000000000000000000000000000000000").strip()
ARC_ESCROW = os.getenv("ARC_ESCROW", "").strip()
ARC_SHOP = os.getenv("ARC_SHOP", "").strip()
ARC_BILLING = os.getenv("ARC_BILLING", "").strip()
ARC_MIN_FEE_GWEI = float(os.getenv("ARC_MIN_FEE_GWEI", "20") or 20)

# Panel cleaning: alert under DUST_PCT of the clean level, pay the cleaner at CLEAN_PCT or more
PANEL_BEST_W = float(os.getenv("PANEL_BEST_W", "0") or 0)  # clean panel, all flats on solar (calibrate)
DUST_PCT = float(os.getenv("DUST_PCT", "70") or 70)
CLEAN_PCT = float(os.getenv("CLEAN_PCT", "90") or 90)
CLEAN_FEE_USDC = float(os.getenv("CLEAN_FEE_USDC", "2") or 2)
CLEAN_DEADLINE_MIN = int(os.getenv("CLEAN_DEADLINE_MIN", "60") or 60)
CLEAN_AUTO = os.getenv("CLEAN_AUTO", "true").lower() == "true"  # open the escrow by itself when dusty
DUST_RECHECK_S = float(os.getenv("DUST_RECHECK_S", "120") or 120)  # wait before asking 0G about the dust again

# Monthly bills (SolarBilling). 1 Wh on the model = BILL_SCALE/1000 kWh in the real building.
BILL_SCALE = float(os.getenv("BILL_SCALE", "1000") or 1000)
SOLAR_RATE_USDC = float(os.getenv("SOLAR_RATE_USDC", "0.008") or 0.008)  # per kWh of the building's solar
GRID_RATE_USDC = float(os.getenv("GRID_RATE_USDC", "0.02") or 0.02)      # per kWh of grid power
# Optional: only this wallet may pay a flat's bill. "A=0x..,B=0x..". Empty = anyone may pay for the flat.
FLAT_WALLETS = dict(x.split("=", 1) for x in os.getenv("FLAT_WALLETS", "").replace(" ", "").split(",") if "=" in x)
