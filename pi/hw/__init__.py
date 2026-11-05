"""Hardware layer. Pick the backend with DYNAURA_HW=sim or DYNAURA_HW=real."""
from .base import FLATS, METERS, Hardware, Reading


def load_hardware(kind: str) -> Hardware:
    kind = (kind or "sim").lower()
    if kind == "sim":
        from .sim import SimHardware
        from config import SIM_SPEED, SIM_START
        return SimHardware(speed=SIM_SPEED, start=SIM_START)
    if kind == "real":
        from .real import RealHardware  # written by Devang
        return RealHardware()
    raise ValueError(f"DYNAURA_HW must be 'sim' or 'real', got {kind!r}")


__all__ = ["FLATS", "METERS", "Hardware", "Reading", "load_hardware"]
