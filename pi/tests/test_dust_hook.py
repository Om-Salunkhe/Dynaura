"""Offline test of the dust-confirm hook in pi/cleaning.py: no escrow opens unless 0G says the panel
is dirty, and none when 0G is down. Fakes stand in for the hardware, Arc and the 0G call.

Run from pi/:  python tests/test_dust_hook.py
"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import cleaning  # noqa: E402
import config  # noqa: E402
import zg  # noqa: E402
from store import Store  # noqa: E402


class FakeHw:
    pct = 50.0

    def panel_health_pct(self):
        return self.pct


class FakeLoop:
    state = {}


class FakeArc:
    enabled = True
    escrow = object()

    def __init__(self):
        self.opened = []

    def open_cleaning(self, fee, deadline, lvl):
        self.opened.append(lvl)
        return len(self.opened), "0xopen"

    def job(self, job_id):
        return {"status": "open", "cleaner": None}


def watch(confirm=None):
    store = Store(str(Path(tempfile.mkdtemp()) / "t.db"))
    arc = FakeArc()
    w = cleaning.CleaningWatch(FakeHw(), FakeLoop(), store, arc)
    w.confirm_dirty = confirm
    for _ in range(cleaning.WINDOW):  # fill the 1-minute window under the dust line
        w.step()
    return w, arc


def main():
    config.CLEAN_AUTO = True

    # No hook: today's behaviour, the meter alone opens the escrow
    w, arc = watch()
    assert arc.opened and w.job["og_decision_id"] is None, w.status

    # 0G says not dirty: no escrow, and no new 0G call until DUST_RECHECK_S has passed
    calls = []

    def not_dirty(lvl):
        calls.append(lvl)
        return False, 11
    w, arc = watch(not_dirty)
    w.step()
    assert not arc.opened and w.job is None, w.status
    assert len(calls) == 1, calls

    # 0G down: no escrow, and the status says why
    def down(lvl):
        raise zg.ZGUnavailable("0G call failed: no route to host")
    w, arc = watch(down)
    assert not arc.opened and w.job is None
    assert "no money moved" in (w.status["error"] or ""), w.status

    # 0G confirms: the escrow opens and carries the 0G decision that allowed it
    w, arc = watch(lambda lvl: (True, 42))
    assert arc.opened and w.job["og_decision_id"] == 42, w.job

    print("dust hook: all checks passed")


if __name__ == "__main__":
    main()
