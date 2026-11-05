"""The contract between the software and the board.

Everything above this layer (meter loop, API, 0G planner) only talks to
these methods, so SIM mode and the real Pi behave the same way.
"""
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass

FLATS = ("A", "B", "C")            # Ground, 1st, 2nd floor
METERS = ("panel",) + FLATS        # INA219 0x40, 0x41, 0x44, 0x45
SOURCES = ("solar", "grid")


@dataclass
class Reading:
    v: float   # volts
    ma: float  # milliamps

    @property
    def w(self) -> float:
        return round(self.v * self.ma / 1000, 4)

    def to_dict(self) -> dict:
        return {**asdict(self), "w": self.w}


class Hardware(ABC):
    """Every backend (sim, real) must implement these."""

    @abstractmethod
    def read_meters(self) -> dict[str, Reading]:
        """Return a Reading for every name in METERS."""

    @abstractmethod
    def set_flat(self, flat: str, source: str) -> None:
        """'solar' = relay on, 'grid' = relay off (the safe default)."""

    @abstractmethod
    def flat_source(self, flat: str) -> str:
        """Current source of a flat: 'solar' or 'grid'."""

    @abstractmethod
    def run_pump(self, seconds: float) -> None:
        """Turn the pump on; it must turn itself off after `seconds`."""

    @abstractmethod
    def pump_on(self) -> bool:
        """True while the pump is running."""

    @abstractmethod
    def away(self, flat: str) -> bool:
        """True when the flat's home/away switch is set to away."""

    @abstractmethod
    def safe_stop(self) -> None:
        """All flats to grid, pump off. Must never raise."""

    def close(self) -> None:
        """Release GPIO and buses. Default: safe stop."""
        self.safe_stop()

    @staticmethod
    def check_flat(flat: str) -> None:
        if flat not in FLATS:
            raise ValueError(f"unknown flat {flat!r}, expected one of {FLATS}")

    @staticmethod
    def check_source(source: str) -> None:
        if source not in SOURCES:
            raise ValueError(f"unknown source {source!r}, expected one of {SOURCES}")
