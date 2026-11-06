"""Bench check for the real board. Run on the Pi from the pi/ folder:

    python -m hw.check_real          # read every meter, then switch each flat to solar and back
    python -m hw.check_real --pump   # ...and run the pump for 3 s (put it in a cup of water first)

It ends with every flat on grid and the pump off, even on Ctrl+C.
"""
import argparse
import logging
import time

from dotenv import load_dotenv

from config import ROOT

load_dotenv(ROOT / ".env")

from .base import FLATS  # noqa: E402
from .real import RealHardware  # noqa: E402


def show(hw: RealHardware, label: str) -> None:
    r = hw.read_meters()
    parts = [f"{n}: {x.v:.2f} V {x.ma:6.1f} mA {x.w * 1000:6.1f} mW" for n, x in r.items()]
    print(f"{label:<14}" + " | ".join(parts))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pump", action="store_true", help="also run the pump for 3 seconds")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    hw = RealHardware()
    try:
        if hw.missing:
            print(f"no sensor (estimated): {', '.join(hw.missing)}")
        show(hw, "all grid")
        for f in FLATS:
            hw.set_flat(f, "solar")
            time.sleep(1.5)
            show(hw, f"{f} solar")
            hw.set_flat(f, "grid")
            time.sleep(0.5)
        if args.pump:
            print("pump on for 3 s")
            hw.run_pump(3)
            while hw.pump_on():
                time.sleep(0.2)
            print("pump off")
        show(hw, "all grid")
        print("PASS if each flat went blue -> yellow -> blue and its mA stayed above 5.")
    finally:
        hw.close()


if __name__ == "__main__":
    main()
