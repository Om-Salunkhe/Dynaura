"""Real Raspberry Pi hardware: INA219 meters on I2C and a 4-channel relay board.

Wiring as built (Nov 6, see the hardware notes in docs/architecture.md):
- I2C bus 1 (pin 3 SDA, pin 5 SCL, sensors on 3.3 V from pin 1).
- INA219s: panel 0x45 (the old 0x40 board died), Flat A 0x41, Flat B 0x44, Flat C 0x40 (the new board).
  Every address can be changed in .env (INA_PANEL, INA_A, INA_B, INA_C) without touching code.
- Relays (HW-316, active-low, VCC on pin 4 = 5 V): Flat A GPIO17 (M1), Flat B GPIO27 (M2),
  Flat C GPIO22 (M3), pump GPIO23 (M4).
  Each flat: blue (grid) LED on NC, yellow (solar) LED on NO. Relay off = grid, the safe default.
  The pump sits on M4's NO contact, so relay off = pump off.
- The flat sensors are on the low side (VIN- goes to the ground line), so their bus-voltage
  register reads ~0 V. Their volts come from SUPPLY_V (the power bank, 5 V).
- The panel sensor reads the panel's own voltage when it is wired high-side. If it reads ~0 V
  (low-side wiring), PANEL_V is used while current flows.

No extra Python packages: I2C uses smbus2 or the Pi's own python3-smbus (the venv is made with
--system-site-packages), and GPIO uses the `pinctrl` command that the bench tests used, or
gpiozero when pinctrl is not there. DYNAURA_GPIO=pinctrl|gpiozero forces one.

A flat whose sensor is missing at start is not fatal: it reports FLAT_NOMINAL_MA (the ~10.5 mA one
lit LED draws) and the state says "estimated". A missing panel sensor is fatal, because the
cleaning and credits logic would be guessing.
"""
from __future__ import annotations

import logging
import os
import shutil
import subprocess
import threading
import time

from .base import FLATS, METERS, Hardware, Reading

log = logging.getLogger("dynaura.hw.real")

# INA219 registers (big-endian 16-bit words)
REG_CONFIG = 0x00
REG_SHUNT = 0x01   # LSB 10 uV
REG_BUS = 0x02     # bits 15..3, LSB 4 mV


def _env(name: str, default: str) -> str:
    v = os.getenv(name, "")
    return v.strip() if v and v.strip() else default


def _env_addr(name: str, default: int) -> int | None:
    raw = _env(name, hex(default)).lower()
    if raw in ("none", "off", "-"):
        return None
    return int(raw, 16) if raw.startswith("0x") else int(raw)


def _env_f(name: str, default: float) -> float:
    try:
        return float(_env(name, str(default)))
    except ValueError:
        return default


# ---- I2C ----------------------------------------------------------------------------------
def _open_bus(bus: int):
    try:
        from smbus2 import SMBus  # type: ignore
    except ImportError:
        try:
            from smbus import SMBus  # type: ignore  # python3-smbus from Raspberry Pi OS
        except ImportError as e:
            raise RuntimeError("no I2C library: run `sudo apt install python3-smbus` "
                               "(and make the venv with --system-site-packages)") from e
    return SMBus(bus)


class INA219:
    """Just enough INA219: shunt current and bus voltage, no calibration register needed."""

    def __init__(self, bus, addr: int, shunt_ohms: float):
        self.bus, self.addr, self.shunt_ohms = bus, addr, shunt_ohms

    def _word(self, reg: int) -> int:
        w = self.bus.read_word_data(self.addr, reg)
        return ((w & 0xFF) << 8) | (w >> 8)  # SMBus is little-endian, the INA219 big-endian

    def present(self) -> bool:
        try:
            self._word(REG_CONFIG)
            return True
        except OSError:
            return False

    def read(self) -> tuple[float, float]:
        """(bus volts, milliamps)."""
        raw = self._word(REG_SHUNT)
        if raw > 32767:
            raw -= 65536
        shunt_mv = raw * 0.01
        ma = shunt_mv / self.shunt_ohms
        bus_v = (self._word(REG_BUS) >> 3) * 0.004
        return bus_v, ma


# ---- GPIO ---------------------------------------------------------------------------------
class _PinctrlOut:
    """Drives a pin with the `pinctrl` CLI (Raspberry Pi OS Bookworm). State stays after we exit."""

    def __init__(self, gpio: int, active_low: bool):
        self.gpio, self.active_low = gpio, active_low

    def set(self, on: bool) -> None:
        level_high = (not on) if self.active_low else on
        subprocess.run(["pinctrl", "set", str(self.gpio), "op", "dh" if level_high else "dl"],
                       check=True, timeout=3, capture_output=True)

    def close(self) -> None:
        pass


class _GpiozeroOut:
    def __init__(self, gpio: int, active_low: bool):
        from gpiozero import OutputDevice  # type: ignore
        self.dev = OutputDevice(gpio, active_high=not active_low, initial_value=False)

    def set(self, on: bool) -> None:
        self.dev.on() if on else self.dev.off()

    def close(self) -> None:
        self.dev.close()


def _make_out(gpio: int, active_low: bool):
    kind = _env("DYNAURA_GPIO", "auto").lower()
    if kind == "pinctrl" or (kind == "auto" and shutil.which("pinctrl")):
        return _PinctrlOut(gpio, active_low)
    if kind in ("gpiozero", "auto"):
        try:
            return _GpiozeroOut(gpio, active_low)
        except Exception as e:
            raise RuntimeError("no GPIO backend: install pinctrl (Raspberry Pi OS) or gpiozero") from e
    raise ValueError(f"DYNAURA_GPIO must be auto, pinctrl or gpiozero, got {kind!r}")


# ---- the board ----------------------------------------------------------------------------
class RealHardware(Hardware):
    def __init__(self, bus=None, out_factory=None):
        """`bus` and `out_factory(gpio, active_low)` are for tests; the Pi uses the defaults."""
        self._lock = threading.RLock()
        self.supply_v = _env_f("SUPPLY_V", 5.0)
        self.panel_v = _env_f("PANEL_V", 6.0)
        self.flat_nominal_ma = _env_f("FLAT_NOMINAL_MA", 10.5)
        self.stale_s = _env_f("METER_STALE_S", 10.0)
        shunt = _env_f("INA_SHUNT_OHMS", 0.1)
        active_low = _env("RELAY_ACTIVE_LOW", "true").lower() != "false"

        addrs = {
            "panel": _env_addr("INA_PANEL", 0x45),
            "A": _env_addr("INA_A", 0x41),
            "B": _env_addr("INA_B", 0x44),
            "C": _env_addr("INA_C", 0x40),
        }
        gpios = {
            "A": int(_env("RELAY_A_GPIO", "17")),
            "B": int(_env("RELAY_B_GPIO", "27")),
            "C": int(_env("RELAY_C_GPIO", "22")),
            "pump": int(_env("PUMP_GPIO", "23")),
        }

        # Relays first, all off: flats on grid and the pump off before anything else can fail.
        make = out_factory or _make_out
        self._out = {k: make(g, active_low) for k, g in gpios.items()}
        self._source = {f: "grid" for f in FLATS}
        self._away = {f: False for f in FLATS}
        self._last: dict[str, tuple[float, Reading]] = {}
        self._pump_until = 0.0
        self._pump_timer: threading.Timer | None = None
        self.safe_stop()

        self._bus = bus if bus is not None else _open_bus(int(_env("I2C_BUS", "1")))
        self._ina: dict[str, INA219] = {}
        self.missing: list[str] = []
        for name in METERS:
            a = addrs[name]
            ina = INA219(self._bus, a, shunt) if a is not None else None
            if ina and ina.present():
                self._ina[name] = ina
            else:
                self.missing.append(name)
        if "panel" in self.missing:
            raise RuntimeError(f"panel INA219 not found at {hex(addrs['panel'] or 0)}: check the wiring "
                               "with `i2cdetect -y 1`, or set INA_PANEL in .env")
        for name in self.missing:
            log.warning("no INA219 for flat %s at %s: reporting an estimate (%s mA)",
                        name, hex(addrs[name]) if addrs[name] else "none", self.flat_nominal_ma)
        log.info("real hardware ready: meters %s, relays %s",
                 {n: hex(i.addr) for n, i in self._ina.items()}, gpios)

    # ---- meters ---------------------------------------------------------------------------
    def _read_one(self, name: str) -> Reading:
        ina = self._ina.get(name)
        if ina is None:  # flat without a sensor: one lit LED's worth, nothing when away
            return Reading(self.supply_v, 0.0 if self._away[name] else self.flat_nominal_ma)
        err: OSError | None = None
        for attempt in range(2):  # a relay click can upset one I2C read; try once more
            try:
                bus_v, ma = ina.read()
                break
            except OSError as e:
                err = e
                time.sleep(0.005)
        else:
            last = self._last.get(name)
            if last and time.monotonic() - last[0] < self.stale_s:
                return last[1]
            raise OSError(f"INA219 {name} at {hex(ina.addr)} not answering") from err

        ma = max(0.0, ma)  # a reversed shunt or noise must not make negative energy
        if name == "panel":
            v = bus_v if bus_v >= 0.5 else (self.panel_v if ma > 0.5 else 0.0)
        else:
            v = bus_v if bus_v >= 0.5 else self.supply_v
        r = Reading(round(v, 3), round(ma, 1))
        self._last[name] = (time.monotonic(), r)
        return r

    def read_meters(self) -> dict[str, Reading]:
        with self._lock:
            return {name: self._read_one(name) for name in METERS}

    # ---- relays ---------------------------------------------------------------------------
    def set_flat(self, flat: str, source: str) -> None:
        self.check_flat(flat)
        self.check_source(source)
        with self._lock:
            self._out[flat].set(source == "solar")
            self._source[flat] = source

    def flat_source(self, flat: str) -> str:
        self.check_flat(flat)
        return self._source[flat]

    # ---- pump -----------------------------------------------------------------------------
    def _pump_off(self) -> None:
        with self._lock:
            try:
                self._out["pump"].set(False)
            finally:
                self._pump_until = 0.0

    def run_pump(self, seconds: float) -> None:
        seconds = max(0.0, float(seconds))
        with self._lock:
            if self._pump_timer:
                self._pump_timer.cancel()
            if seconds <= 0:
                self._pump_off()
                return
            self._out["pump"].set(True)
            self._pump_until = time.monotonic() + seconds
            self._pump_timer = threading.Timer(seconds, self._pump_off)
            self._pump_timer.daemon = True
            self._pump_timer.start()

    def pump_on(self) -> bool:
        return time.monotonic() < self._pump_until

    # ---- home / away (no switches on the model: set from the app's demo buttons) ----------
    def away(self, flat: str) -> bool:
        self.check_flat(flat)
        return self._away[flat]

    def set_away(self, flat: str, away: bool) -> None:
        self.check_flat(flat)
        self._away[flat] = bool(away)

    # ---- safety ---------------------------------------------------------------------------
    def safe_stop(self) -> None:
        """Every relay off (flats on grid, pump off). Never raises: each relay is tried on its own."""
        with self._lock:
            if self._pump_timer:
                self._pump_timer.cancel()
                self._pump_timer = None
            self._pump_until = 0.0
            for key, out in self._out.items():
                try:
                    out.set(False)
                except Exception:
                    log.exception("safe_stop: relay %s did not switch off", key)
                if key in FLATS:
                    self._source[key] = "grid"

    def close(self) -> None:
        self.safe_stop()
        for out in self._out.values():
            try:
                out.close()
            except Exception:
                pass
        try:
            self._bus.close()
        except Exception:
            pass
