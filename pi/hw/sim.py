"""SIM mode: a fake building so the software can be built without the board.

- The sun follows a smooth curve from 06:00 to 18:30 (peak about 4.6 W).
- SIM_SPEED makes the day run faster (60 = one simulated minute per second).
- Demo moments: set_moment("cloud" | "dust" | "clean" | "sun").
"""
import math
import random
import threading
import time
from datetime import datetime, timedelta

from .base import FLATS, Hardware, Reading

PANEL_PEAK_W = 4.6
SUNRISE_H, SUNSET_H = 6.0, 18.5
GRID_V = 5.0
HOME_MA = {"A": 70, "B": 45, "C": 85}  # typical load per flat at home
AWAY_MA = 4


class SimHardware(Hardware):
    def __init__(self, speed: float = 1.0, start: datetime | None = None, seed: int = 7):
        self.speed = max(speed, 0.001)
        self._t0_real = time.monotonic()
        self._t0_sim = start or datetime.now()
        self._rng = random.Random(seed)
        self._lock = threading.Lock()
        self._source = {f: "grid" for f in FLATS}
        self._away = {f: False for f in FLATS}
        self._pump_until = 0.0
        self._sky = 1.0     # 1 = clear, 0.3 = cloud
        self._dust = 1.0    # 1 = clean panel, 0.6 = dusty

    # ---- simulated clock -------------------------------------------------
    def now(self) -> datetime:
        elapsed = (time.monotonic() - self._t0_real) * self.speed
        return self._t0_sim + timedelta(seconds=elapsed)

    def sun_fraction(self) -> float:
        t = self.now()
        h = t.hour + t.minute / 60 + t.second / 3600
        if not SUNRISE_H < h < SUNSET_H:
            return 0.0
        return math.sin(math.pi * (h - SUNRISE_H) / (SUNSET_H - SUNRISE_H)) ** 1.5

    # ---- demo moments ----------------------------------------------------
    def set_moment(self, name: str) -> None:
        with self._lock:
            if name == "cloud":
                self._sky = 0.3
            elif name == "sun":
                self._sky = 1.0
            elif name == "dust":
                self._dust = 0.6
            elif name == "clean":
                self._dust = 1.0
            else:
                raise ValueError(f"unknown moment {name!r}")

    def panel_health_pct(self) -> float | None:
        """SIM knows the dust directly (clouds do not count as dirt). None when the sun is too low."""
        if self.sun_fraction() < 0.2:
            return None
        return round(self._dust * 100 * self._rng.uniform(0.98, 1.02), 1)

    def set_away(self, flat: str, away: bool) -> None:
        self.check_flat(flat)
        with self._lock:
            self._away[flat] = away

    # ---- Hardware interface ---------------------------------------------
    def read_meters(self) -> dict[str, Reading]:
        with self._lock:
            noise = lambda: self._rng.uniform(0.97, 1.03)
            panel_w_max = PANEL_PEAK_W * self.sun_fraction() * self._sky * self._dust
            solar_v = min(GRID_V, 6.0 * min(1.0, panel_w_max / 1.0)) if panel_w_max > 0 else 0.0

            flats: dict[str, Reading] = {}
            solar_ma = 0.0
            for f in FLATS:
                ma = (AWAY_MA if self._away[f] else HOME_MA[f]) * noise()
                if self._source[f] == "solar" and solar_v > 0.5:
                    v = solar_v
                    solar_ma += ma
                else:
                    v = GRID_V * noise() ** 0.1
                flats[f] = Reading(round(v, 3), round(ma, 1))

            # Panel current = what the solar flats draw, capped by the sun
            cap_ma = panel_w_max / solar_v * 1000 if solar_v > 0 else 0.0
            panel = Reading(round(solar_v, 3), round(min(solar_ma, cap_ma), 1))
            return {"panel": panel, **flats}

    def set_flat(self, flat: str, source: str) -> None:
        self.check_flat(flat)
        self.check_source(source)
        with self._lock:
            self._source[flat] = source

    def flat_source(self, flat: str) -> str:
        self.check_flat(flat)
        return self._source[flat]

    def run_pump(self, seconds: float) -> None:
        with self._lock:
            # real seconds, so the demo pump timer behaves like the board
            self._pump_until = time.monotonic() + max(0.0, seconds)

    def pump_on(self) -> bool:
        return time.monotonic() < self._pump_until

    def away(self, flat: str) -> bool:
        self.check_flat(flat)
        return self._away[flat]

    def safe_stop(self) -> None:
        with self._lock:
            for f in FLATS:
                self._source[f] = "grid"
            self._pump_until = 0.0
