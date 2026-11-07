"""pi/hw/real.py against a fake I2C bus and fake relays (no Pi needed).

Run: cd pi && python tests/test_real_hw.py
"""
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from hw.real import RealHardware  # noqa: E402


def word(v: int) -> int:
    """What SMBus.read_word_data returns for a big-endian INA219 register value."""
    v &= 0xFFFF
    return ((v & 0xFF) << 8) | (v >> 8)


class FakeBus:
    def __init__(self, sensors):
        self.sensors = sensors  # addr -> {"shunt": raw, "bus_v": volts}
        self.fail_once: set[int] = set()
        self.dead: set[int] = set()

    def read_word_data(self, addr, reg):
        if addr not in self.sensors or addr in self.dead:
            raise OSError(121, "Remote I/O error")
        if addr in self.fail_once:
            self.fail_once.discard(addr)
            raise OSError(5, "Input/output error")
        s = self.sensors[addr]
        if reg == 0:
            return word(0x399F)
        if reg == 1:
            return word(s["shunt"])
        if reg == 2:
            return word(int(s["bus_v"] / 0.004) << 3)
        raise AssertionError(reg)

    def close(self):
        pass


class FakeOut:
    log = []

    def __init__(self, gpio, active_low):
        self.gpio, self.active_low, self.on = gpio, active_low, None

    def set(self, on):
        self.on = on
        FakeOut.log.append((self.gpio, on))

    def close(self):
        pass


def make(sensors, **env):
    for k in ("INA_PANEL", "INA_A", "INA_B", "INA_C", "SUPPLY_V", "PANEL_V", "FLAT_NOMINAL_MA"):
        os.environ.pop(k, None)
    os.environ.update(env)
    outs = {}

    def factory(gpio, active_low):
        outs[gpio] = FakeOut(gpio, active_low)
        return outs[gpio]

    bus = FakeBus(sensors)
    return RealHardware(bus=bus, out_factory=factory), bus, outs


def ok(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print("  ok ", msg)


# panel high-side at 0x45 reading 5.2 V / 300 mA; flats low-side (bus ~0 V) at ~10.5 mA
FULL = {0x45: {"shunt": 3000, "bus_v": 5.2}, 0x41: {"shunt": 105, "bus_v": 0.0},
        0x44: {"shunt": 104, "bus_v": 0.0}, 0x40: {"shunt": 106, "bus_v": 0.0}}

hw, bus, outs = make(dict(FULL))
ok(all(o.on is False for o in outs.values()), "every relay starts off (grid, pump off)")
ok(sorted(outs) == [17, 22, 23, 27] and all(o.active_low for o in outs.values()), "relays on GPIO 17/27/22/23, active-low")
r = hw.read_meters()
ok(set(r) == {"panel", "A", "B", "C"}, "a reading for every meter")
ok(r["panel"].v == 5.2 and r["panel"].ma == 300.0, f"panel 5.2 V 300 mA (got {r['panel']})")
ok(r["A"].v == 5.0 and r["A"].ma == 10.5, f"flat A: low-side volts from SUPPLY_V, 10.5 mA (got {r['A']})")
ok(abs(r["A"].w - 0.0525) < 1e-6, "flat A watts = 5 V x 10.5 mA")
ok(abs(hw.solar_available_w() - r["panel"].w) < 1e-9, "available sun = the panel meter (its own load)")
os.environ["PANEL_READS_AVAILABLE"] = "false"
ok(hw.solar_available_w() is None, "PANEL_READS_AVAILABLE=false: unknown, credits fall back to settings")
del os.environ["PANEL_READS_AVAILABLE"]

hw.set_flat("B", "solar")
ok(outs[27].on is True and hw.flat_source("B") == "solar", "B to solar clicks GPIO27 on")
hw.set_flat("B", "grid")
ok(outs[27].on is False and hw.flat_source("B") == "grid", "B back to grid")

hw.run_pump(0.3)
ok(outs[23].on is True and hw.pump_on(), "pump on")
time.sleep(0.5)
ok(outs[23].on is False and not hw.pump_on(), "pump turns itself off")

hw.set_flat("A", "solar")
hw.set_flat("C", "solar")
hw.run_pump(10)
hw.safe_stop()
ok(all(o.on is False for o in outs.values()), "safe stop: every relay off")
ok(all(hw.flat_source(f) == "grid" for f in "ABC") and not hw.pump_on(), "safe stop: all grid, pump off")

bus.fail_once.add(0x41)
ok(hw.read_meters()["A"].ma == 10.5, "one failed read is retried")
bus.dead.add(0x41)
ok(hw.read_meters()["A"].ma == 10.5, "a dead sensor returns its last good reading for a while")
hw._last["A"] = (time.monotonic() - 60, hw._last["A"][1])
try:
    hw.read_meters()
    ok(False, "a long-dead sensor must raise")
except OSError:
    ok(True, "a sensor dead for > METER_STALE_S raises (the meter loop then safe-stops)")

# Flat C sensor missing: estimated, not fatal
no_c = {k: v for k, v in FULL.items() if k != 0x40}
hw2, _, _ = make(no_c)
ok(hw2.missing == ["C"], "missing flat C sensor is reported")
ok(hw2.read_meters()["C"].ma == 10.5, "flat C estimated at FLAT_NOMINAL_MA")
hw2.set_away("C", True)
ok(hw2.away("C") and hw2.read_meters()["C"].ma == 0.0, "estimated flat reads 0 when away")

# addresses come from .env
moved = {0x40: FULL[0x45], 0x41: FULL[0x41], 0x44: FULL[0x44], 0x45: FULL[0x40]}
hw3, _, _ = make(moved, INA_PANEL="0x40", INA_C="0x45")
ok(hw3.read_meters()["panel"].ma == 300.0, "INA_PANEL / INA_C from .env")
hw4, _, _ = make(no_c, INA_C="none")
ok(hw4.missing == ["C"], "INA_C=none means no sensor")

# panel wired low-side: bus reads 0 V, PANEL_V used while current flows
low = dict(FULL)
low[0x45] = {"shunt": 3000, "bus_v": 0.0}
hw5, _, _ = make(low)
ok(hw5.read_meters()["panel"].v == 6.0, "low-side panel uses PANEL_V")

# PANEL_SENSE=voltage: no current through the panel, the sun level comes from its voltage
volt = dict(FULL)
volt[0x45] = {"shunt": 0, "bus_v": 2.3}
hw6, bus6, _ = make(volt, PANEL_SENSE="voltage", PANEL_V_DARK="0.5", PANEL_V_SUN="2.3", PANEL_RATED_W="1.0")
p6 = hw6.read_meters()["panel"]
ok(abs(p6.w - 1.0) < 0.01 and p6.v == 2.3, f"lamp on (2.3 V, 0 mA) = 100 % sun = PANEL_RATED_W (got {p6})")
bus6.sensors[0x45]["bus_v"] = 1.4
ok(abs(hw6.read_meters()["panel"].w - 0.5) < 0.01, "halfway between dark and sun voltage = half the watts")
ok(abs(hw6.solar_available_w() - 0.5) < 0.01, "available sun follows the voltage")
ok(abs(hw6.panel_health_pct() - 50.0) < 0.5, "panel health = the sun level in % (for the dust check)")
ok(hw.panel_health_pct() is None, "current mode: health left to the cleaning watch (PANEL_BEST_W)")
bus6.sensors[0x45]["bus_v"] = 0.3
ok(hw6.read_meters()["panel"].w == 0.0, "below PANEL_V_DARK = no sun")
bus6.sensors[0x45]["bus_v"] = 3.0
ok(abs(hw6.read_meters()["panel"].w - 1.0) < 0.01, "brighter than PANEL_V_SUN is capped at 100 %")
for k in ("PANEL_SENSE", "PANEL_V_DARK", "PANEL_V_SUN", "PANEL_RATED_W"):
    os.environ.pop(k, None)

# missing panel sensor is fatal
try:
    make({k: v for k, v in FULL.items() if k != 0x45})
    ok(False, "missing panel must raise")
except RuntimeError as e:
    ok("panel INA219 not found" in str(e), "missing panel sensor stops start-up with a clear message")

# load_hardware("real") wiring
from hw import load_hardware  # noqa: E402
ok(callable(load_hardware), "load_hardware still imports")

print("real hardware: all checks passed")
