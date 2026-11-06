"""Offline test of the v3 cleaning flow in pi/cleaning.py (DECISIONS Fri 22:12): every transition.

Fakes stand in for the hardware, the camera, the 0G dust check and Arc; the store is a real SQLite
file. No network, no wallet.

Run from pi/:  python tests/test_cleaning_v3.py
"""
import sys
import tempfile
import time
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Without the Pi's packages installed (web3, openai, dotenv), stub them: this test never calls them.
for name, attrs in {"web3": ["Web3"], "eth_account": ["Account"], "openai": ["OpenAI"], "httpx": ["Timeout"]}.items():
    try:
        __import__(name)
    except ImportError:
        sys.modules[name] = types.SimpleNamespace(**{a: type(a, (), {}) for a in attrs})
try:
    import dotenv  # noqa: F401
except ImportError:
    sys.modules["dotenv"] = types.SimpleNamespace(load_dotenv=lambda *a, **k: None)

import config  # noqa: E402

TMP = Path(tempfile.mkdtemp(prefix="dynaura-clean-"))
config.DB_PATH = str(TMP / "t.db")  # the camera frame is kept next to the database

import cleaning  # noqa: E402
import zg  # noqa: E402
from arc import ArcUnavailable  # noqa: E402
from store import Store  # noqa: E402

DIRTY = {"dirty": True, "coverage_pct": 40, "reason": "dust film over the left cells", "request_id": "chat-dust-1",
         "tee": True, "input": "vision", "model": "vision-test"}
CLEAN = {**DIRTY, "dirty": False, "coverage_pct": 0, "reason": "clean glass", "request_id": "chat-dust-2"}


class FakeHw:
    pct = 100.0

    def panel_health_pct(self):
        return self.pct


class FakeLoop:
    state = {"solar_w": 2.0}


class FakeArc:
    enabled = True
    escrow = object()

    def __init__(self):
        self.calls = []
        self.chain = {}            # escrow id -> status on "Arc"
        self.fail_open = False

    def open_cleaning(self, fee, deadline, lvl, og_request_id=""):
        if self.fail_open:
            raise RuntimeError("rpc down")
        jid = len(self.chain) + 1
        self.chain[jid] = "open"
        self.calls.append(("open", fee, lvl, og_request_id))
        return jid, f"0xopen{jid}"

    def job(self, jid):
        st = self.chain[jid]
        return {"status": st, "cleaner": "0x" + "c1" * 20 if st != "open" else "0x" + "00" * 20, "output_after": 0}

    def release_cleaning(self, jid, pct, proof):
        self.chain[jid] = "paid"
        self.calls.append(("release", jid, pct, proof))
        return f"0xrelease{jid}"

    def refund_cleaning(self, jid):
        self.chain[jid] = "refunded"
        self.calls.append(("refund", jid))
        return f"0xrefund{jid}"

    def link_episode(self, jid, root):
        self.calls.append(("link", jid, root))
        return "0xlink"


class Dust:
    """The 0G dust check: returns the next verdict, or raises when 0G is 'down'."""

    def __init__(self, verdict=DIRTY):
        self.verdict, self.down, self.ctx = verdict, False, []

    def __call__(self, jpeg, ctx):
        assert jpeg.startswith(b"\xff\xd8"), "the camera frame goes to 0G"
        self.ctx.append(ctx)
        if self.down:
            raise zg.ZGUnavailable("0G call failed: no route to host")
        return dict(self.verdict)


def camera(hw):
    return b"\xff\xd8 fake jpeg, dust=%d" % int(hw.pct)


def make(dust=None, cam=camera, store=None):
    store = store or Store(config.DB_PATH.replace("t.db", f"t{len(list(TMP.iterdir()))}.db"))
    arc, hw = FakeArc(), FakeHw()
    w = cleaning.CleaningWatch(hw, FakeLoop(), store, arc, capture=cam, check_dust=dust)
    w.arkiv = []
    w.on_job = w.arkiv.append
    return w, arc, hw


def minute(w, pct):
    """One minute of meter readings at pct."""
    w.hw.pct = pct
    for _ in range(cleaning.WINDOW):
        w.step()


def check(name, cond, info=None):
    assert cond, f"{name}: {info}"
    print("  ok ", name)


def main():
    config.CLEAN_AUTO, config.DUST_PCT, config.CLEAN_PCT, config.MIN_GAIN_PCT = True, 70.0, 90.0, 15.0
    config.DUST_RECHECK_S, config.CLEAN_FEE_USDC, config.CLEAN_DEADLINE_MIN = 120.0, 2.0, 60

    print("look: the meter drop only triggers a look")
    w, arc, _ = make(dust=None, cam=None)
    minute(w, 50)
    check("no camera/0G installed: nothing flagged, no crash", w.job is None and not w.status["dust_check"], w.status)
    dust = Dust(CLEAN)
    w, arc, _ = make(dust)
    minute(w, 100)
    check("clean panel: no look at all", not dust.ctx)
    minute(w, 50)
    check("drop: one look, 0G says clean -> nothing flagged", w.job is None and len(dust.ctx) == 1, w.status)
    check("the look carries the meter context", dust.ctx[0]["health_pct"] == 50 and dust.ctx[0]["source"] == "meter", dust.ctx)
    check("last_check says clean", w.status["last_check"]["result"] == "clean")
    minute(w, 50)
    check("no second look before DUST_RECHECK_S", len(dust.ctx) == 1, len(dust.ctx))
    check("no money moved", not arc.calls)

    print("0G down: nothing flagged, no_check logged")
    dust = Dust()
    dust.down = True
    w, arc, _ = make(dust)
    minute(w, 50)
    check("no job", w.job is None)
    check("no_check decision", w.store.latest("dust")["mode"] == "no_check", w.store.latest("dust"))
    check("no_check sent to Arkiv", w.arkiv and w.arkiv[-1]["state"] == "no_check", w.arkiv)
    try:
        w.scan()
        check("admin scan raises when 0G is down", False)
    except zg.ZGUnavailable:
        check("admin scan raises when 0G is down", True)
    check("still no job and no money", w.job is None and not arc.calls)

    print("dirty -> flagged -> rejected")
    dust = Dust()
    w, arc, _ = make(dust)
    out = w.scan()
    j = out["job"]
    check("admin scan flags the panel", j["state"] == "flagged" and j["id"], j)
    check("0G evidence kept", j["og"]["request_id"] == "chat-dust-1" and j["og"]["tee"] is True
          and j["og"]["coverage_pct"] == 40 and j["og"]["frame_url"] == "/api/camera/latest.jpg", j["og"])
    check("dust decision recorded (kind dust, mode ai)", w.store.decision(j["og"]["decision_id"])["mode"] == "ai")
    check("frame kept for /api/camera/latest.jpg", w.frame and w.frame.startswith(b"\xff\xd8"))
    check("no money before approval", not arc.calls)
    check("flagged sent to Arkiv", w.arkiv[-1]["state"] == "flagged")
    check("a second scan returns the same job", w.scan()["job"]["id"] == j["id"])
    w.reject()
    check("reject -> rejected, in history", w.job is None and w.history[0]["state"] == "rejected")
    check("still no money", not arc.calls)
    minute(w, 50)
    check("after reject the meter waits before looking again", len(dust.ctx) == 1, len(dust.ctx))
    for fn in (w.approve, w.reject, w.mark_done):
        try:
            fn()
            check(f"{fn.__name__} without a request fails", False)
        except ValueError:
            check(f"{fn.__name__} without a request fails", True)

    print("flagged -> approved -> open -> accepted -> cleaned -> paid")
    dust = Dust()
    w, arc, hw = make(dust)
    minute(w, 50)
    check("meter drop flags it", w.job and w.job["state"] == "flagged" and w.job["dusty_pct"] == 50, w.status)
    arc.fail_open = True
    try:
        w.approve()
    except RuntimeError:
        pass
    check("Arc failure on approve: back to flagged", w.job["state"] == "flagged" and w.job["deadline"] is None, w.job)
    arc.fail_open = False
    j = w.approve(fee_usdc=2.5)["job"]
    check("approve opens the escrow with the 0G request id", arc.calls[-1] == ("open", 2.5, 50, "chat-dust-1"), arc.calls)
    check("job is open with the Arc id", j["state"] == "open" and j["arc"]["job_id"] == 1 and j["job_id"] == 1, j)
    try:
        w.mark_done()
        check("Mark done before anyone accepted fails", False)
    except ValueError:
        check("Mark done before anyone accepted fails", True)
    arc.chain[1] = "accepted"
    w.step()
    check("cleaner accepted on Arc -> accepted", w.job["state"] == "accepted" and w.job["cleaner"], w.job)
    check("arc.cleaner is the accepting wallet", w.job["arc"]["cleaner"] == "0x" + "c1" * 20, w.job["arc"])
    w.mark_done()
    check("Mark done -> cleaned, window restarts", w.job["state"] == "cleaned" and not w.samples, w.job)
    minute(w, 60)
    check("still dusty after Mark done: not paid", w.job["state"] == "cleaned" and w.job["after_pct"] == 60)
    w.store.set_decision(w.job["og"]["decision_id"], storage_root="0x" + "ab" * 32)
    w._last_poll = 0
    w.step()
    check("0G Storage root linked into the escrow once", [c for c in arc.calls if c[0] == "link"] == [("link", 1, "0x" + "ab" * 32)])
    for m in (1_800_000_000, 1_800_000_060, 1_800_000_120):  # the signed 1-minute readings the proof covers
        w.store.add_summary({"minute": m, "meter": "panel", "avg_w": 4.6, "wh": 0.08, "solar_wh": 0.08,
                             "samples": 60, "sig": "0xsig"})
    minute(w, 96)
    check("panel back at 96%: paid", w.job is None and w.history[0]["state"] == "paid", w.status)
    rel = [c for c in arc.calls if c[0] == "release"][0]
    paid = w.history[0]
    check("release carries the meter proof", rel[2] == 96 and len(rel[3]) == 32
          and paid["arc"]["proof_hash"] == "0x" + rel[3].hex(), (rel, paid["arc"]))
    check("proof window = the minutes the hash covers", paid["arc"]["proof_window"] == [1_800_000_000, 1_800_000_120],
          paid["arc"])
    check("paid sent to Arkiv with the proof", w.arkiv[-1]["state"] == "paid" and w.arkiv[-1]["arc"]["release_tx"])
    w.set_arkiv_key(paid["id"], "0xkey")
    check("the bridge's key is kept as arkiv_key", w.history[0]["arkiv_key"] == "0xkey")

    print("Pawan's rule: clean enough AND clearly better")
    w, arc, _ = make(Dust())
    minute(w, 80)  # 80% is above DUST_PCT... flag by hand
    w.scan()
    w.approve()
    arc.chain[1] = "accepted"
    w._last_poll = 0
    w.step()
    w.mark_done()
    minute(w, 92)
    check("92% after 80% (gain 12 < 15): not paid", w.job and w.job["state"] == "cleaned", w.status)
    minute(w, 97)
    check("97% after 80% (gain 17): paid", w.job is None and w.history[0]["state"] == "paid")

    print("deadline: refund")
    w, arc, _ = make(Dust())
    minute(w, 50)
    w.approve()
    arc.chain[1] = "accepted"
    w._last_poll = 0
    w.step()
    w.job["deadline"] = 0  # the deadline has passed
    w.step()
    check("not proven by the deadline -> refunded", w.history[0]["state"] == "refunded" and arc.chain[1] == "refunded")

    print("dispute -> committee resolves")
    for outcome, label in (("paid", "paid_cleaner"), ("refunded", "refunded")):
        w, arc, _ = make(Dust())
        minute(w, 50)
        w.approve()
        arc.chain[1] = "disputed"
        w._last_poll = 0
        w.step()
        check("cleaner disputed on Arc -> disputed", w.job["state"] == "disputed", w.job)
        w.job["deadline"] = int(time.time()) - 10  # just past the deadline, inside the dispute window
        w.step()
        check("disputed job is not refunded by the Pi inside the dispute window", w.job and w.job["state"] == "disputed")
        w.job["deadline"] = 10 ** 10
        arc.chain[1] = outcome  # the committee wallet called resolve()
        w._last_poll = 0
        w.step()
        h = w.history[0]
        check(f"committee resolve ({outcome}) -> resolved / {label}", h["state"] == "resolved" and h["resolution"] == label, h)
        check("the Pi never paid or refunded it", not [c for c in arc.calls if c[0] in ("release", "refund")])

    print("restart picks the request back up")
    dust = Dust()
    w, arc, _ = make(dust)
    minute(w, 50)
    w.approve()
    w2 = cleaning.CleaningWatch(FakeHw(), FakeLoop(), w.store, arc, capture=camera, check_dust=dust)
    check("open job restored", w2.job and w2.job["state"] == "open" and w2.job["arc"]["job_id"] == 1, w2.job)
    w3, arc3, _ = make(Dust())
    w3.scan()
    w3.reject()
    w4 = cleaning.CleaningWatch(FakeHw(), FakeLoop(), w3.store, arc3, capture=camera, check_dust=Dust())
    check("finished job restored into history, nothing active", w4.job is None and w4.history[0]["state"] == "rejected")

    print("status keeps the fields older screens and the shop settler read")
    st = w2.status
    check("status shape", {"job", "history", "state", "pct", "last"} <= set(st) and st["job"]["status"] == "open", st.keys())

    try:
        w5, arc5, _ = make(Dust())
        w5.scan()
        arc5.enabled = False
        w5.approve()
        check("approve without Arc raises ArcUnavailable", False)
    except ArcUnavailable:
        check("approve without Arc raises ArcUnavailable", True)

    print("cleaning v3: all checks passed")


if __name__ == "__main__":
    main()
