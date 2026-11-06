"""Offline test of the SolarCredits helpers in pi/arc.py: unit conversion, the rows posted on chain,
and credits_settle (post once, fund only what is missing). A fake contract stands in for Arc.

Run from pi/:  python tests/test_arc_credits.py   (without web3 installed it uses Foundry's cast for keccak)
"""
import subprocess
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    import web3  # noqa: F401
except ImportError:  # no web3 here: stub it, with keccak from Foundry's cast
    class _Hex(bytes):
        def hex(self):
            return "0x" + bytes(self).hex()

    class _Web3:
        @staticmethod
        def keccak(text):
            out = subprocess.run(["cast", "keccak", text], capture_output=True, text=True, check=True).stdout.strip()
            return _Hex(bytes.fromhex(out[2:]))

        @staticmethod
        def to_checksum_address(a):
            return a
    sys.modules["web3"] = types.SimpleNamespace(Web3=_Web3)
    sys.modules["eth_account"] = types.SimpleNamespace(Account=object)
try:
    import dotenv  # noqa: F401
except ImportError:
    sys.modules["dotenv"] = types.SimpleNamespace(load_dotenv=lambda *a, **k: None)

import arc  # noqa: E402
import config  # noqa: E402


class Call:
    def __init__(self, fn, *args):
        self.fn, self.args = fn, args

    def call(self):
        return self.fn(*self.args)


class FakeCredits:
    """Mimics SolarCredits' behaviour (pool * unused / sum(unused)) behind web3's contract API."""
    address = "0x" + "cc" * 20

    def __init__(self):
        self.periods, self.sent = {}, []
        fake = self

        class Functions:
            def postPeriod(self, pid, flats, unused, over, rate, rhash):
                return ("postPeriod", pid, flats, unused, over, rate, rhash)

            def fund(self, pid, amount):
                return ("fund", pid, amount)

            def claim(self, pid, flat):
                return ("claim", pid, flat)

            def periodInfo(self, pid):
                p = fake.periods.get(pid)
                return Call(lambda: (False, 0, b"\0" * 32, 0, 0, 0) if not p else
                            (True, p["rate"], p["rhash"], sum(p["unused"].values()), p["in"], p["claimed_total"]))

            def flatsOf(self, pid):
                return Call(lambda: list(fake.periods[pid]["unused"]))

            def flatInfo(self, pid, f):
                p = fake.periods[pid]
                return Call(lambda: (True, p["unused"][f], p["over"][f], p["paid_in"][f], p["claimed"][f]))

            def walletOf(self, f):
                return Call(lambda: "0x" + "00" * 20 if f == "C" else "0x" + "a1" * 20)

            def claimable(self, pid, f):
                p = fake.periods[pid]
                return Call(lambda: p["in"] * p["unused"][f] // sum(p["unused"].values()) - p["claimed"][f])

        self.functions = Functions()

    def apply(self, tx):
        self.sent.append(tx[0])
        if tx[0] == "postPeriod":
            _, pid, flats, unused, over, rate, rhash = tx
            assert pid not in self.periods, "posted twice"
            self.periods[pid] = {"rate": rate, "rhash": rhash, "in": 0, "claimed_total": 0,
                                 "unused": dict(zip(flats, unused)), "over": dict(zip(flats, over)),
                                 "paid_in": {f: False for f in flats}, "claimed": {f: 0 for f in flats}}
        elif tx[0] == "fund":
            self.periods[tx[1]]["in"] += tx[2]


def make():
    a = object.__new__(arc.Arc)
    a.enabled = True
    a.credits = FakeCredits()
    a.ensure_allowance = lambda spender, units: None
    a.credits_txs = lambda key: {"post_tx": None, "fund_tx": None, "claims": {}}

    def send(tx):
        a.credits.apply(tx)
        return {"transactionHash": bytes.fromhex(f"{len(a.credits.sent):064x}")}
    a.send = send
    return a


def check(name, cond, info=None):
    assert cond, f"{name}: {info}"
    print("  ok ", name)


def main():
    config.BILL_SCALE, config.BUILDING_ID = 1000.0, "sunrise-apartments"

    print("units")
    check("model Wh -> real Wh (1 Wh on the model = 1 kWh real)", arc.wh_to_chain(30) == 30_000)
    check("fractions of a model Wh are kept", arc.wh_to_chain(0.0125) == 12 and arc.wh_to_chain(-3) == 0)
    check("0.013 USDC/kWh -> 13 micro-USDC per Wh", arc.rate_to_chain(0.013) == 13 and arc.rate_to_chain(0.02) == 20)
    pid = arc.credit_period_id("2026-11-07")
    check("period id = keccak(building:key), 0x + 64 hex", pid.startswith("0x") and len(pid) == 66)
    want = subprocess.run(["cast", "keccak", "sunrise-apartments:2026-11-07"], capture_output=True, text=True).stdout.strip()
    check("same id as the e2e script and the web (keccak256 of the text)", pid == want, (pid, want))
    check("period id is stable and per key", pid == arc.credit_period_id("2026-11-07") != arc.credit_period_id("2026-11"))
    check("readings hash from 0x-hex or bytes", arc.as_bytes32("0x" + "ab" * 32) == bytes.fromhex("ab" * 32))
    try:
        arc.as_bytes32("0x1234")
        check("short readings hash refused", False)
    except ValueError:
        check("short readings hash refused", True)

    print("rows posted on chain")
    flats = {"B": {"unused_wh": 10, "over_wh": 0}, "A": {"unused_wh": 30, "over_wh": 0},
             "C": {"unused_wh": 0, "over_wh": 20}}
    names, unused, over = arc.credit_rows(flats)
    check("sorted, in real Wh", (names, unused, over) == (["A", "B", "C"], [30_000, 10_000, 0], [0, 0, 20_000]))
    names, unused, over = arc.credit_rows({"A": {"unused_wh": 0.2, "over_wh": 0.5}})
    check("a flat is under OR over its share, never both", (unused, over) == ([0], [500]))

    print("credits_settle: post once, fund only what is missing")
    a = make()
    out = a.credits_settle("2026-11-07", flats, 0.013, 0.14, "0x" + "ab" * 32)
    check("posted and funded", a.credits.sent == ["postPeriod", "fund"] and out["post_tx"] and out["fund_tx"], a.credits.sent)
    check("pool 0.14 USDC", out["total_in_usdc"] == 0.14, out)
    check("A can claim 3x B", out["flats"]["A"]["claimable_usdc"] == 0.105 and out["flats"]["B"]["claimable_usdc"] == 0.035,
          out["flats"])
    check("an unregistered wallet shows as None", out["flats"]["C"]["wallet"] is None and out["flats"]["A"]["wallet"])
    check("C owes 20 kWh x 0.013", abs(out["flats"]["C"]["owes_usdc"] - 0.26) < 1e-9, out["flats"]["C"])
    check("claims start empty", out["claims"] == {"A": None, "B": None, "C": None}, out["claims"])
    a.credits_settle("2026-11-07", flats, 0.013, 0.14, "0x" + "ab" * 32)
    check("settling again sends nothing", a.credits.sent == ["postPeriod", "fund"], a.credits.sent)
    a.credits_settle("2026-11-07", flats, 0.013, 0.20, "0x" + "ab" * 32)
    check("more revenue later: only the difference is funded", a.credits.sent == ["postPeriod", "fund", "fund"]
          and a.credits_status("2026-11-07")["total_in_usdc"] == 0.2, a.credits.sent)

    print("arc credits: all checks passed")


if __name__ == "__main__":
    main()
