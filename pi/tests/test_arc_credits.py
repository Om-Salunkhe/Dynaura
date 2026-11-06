"""Offline test of the SolarCredits helpers in pi/arc.py: unit conversion, the rows posted on chain,
and the calls the credits settle endpoint makes. A fake contract stands in for Arc.

Run from pi/:  python tests/test_arc_credits.py   (runs without web3 installed)
"""
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    import web3  # noqa: F401
except ImportError:  # no web3 here: stub it, nothing in this test reaches the network
    sys.modules["web3"] = types.SimpleNamespace(Web3=type("Web3", (), {"to_checksum_address": staticmethod(lambda a: a)}))
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
    a.allowances = []
    a.ensure_allowance = lambda spender, units: a.allowances.append(units)

    def send(tx):
        a.credits.apply(tx)
        return {"transactionHash": bytes.fromhex(f"{len(a.credits.sent):064x}")}
    a.send = send
    return a


def check(name, cond, info=None):
    assert cond, f"{name}: {info}"
    print("  ok ", name)


def main():
    import hashlib
    print("period id and hashes")
    pid = arc.credit_period_id("2026-11-07")
    want = "0x" + hashlib.sha256(b"dynaura-credits:2026-11-07").hexdigest()
    check("period id = sha256('dynaura-credits:<day>'), as pi/credits.py makes it", pid == want, pid)
    check("period id from 0x-hex or bytes", arc.as_bytes32(pid) == bytes.fromhex(want[2:]) == arc.as_bytes32(bytes.fromhex(want[2:])))
    try:
        arc.as_bytes32("0x1234")
        check("short hash refused", False)
    except ValueError:
        check("short hash refused", True)

    print("post_credits / fund_credits (dy-arkiv's settle endpoint)")
    a = make()
    readings = "0x" + "ab" * 32
    tx = a.post_credits(pid, ["A", "B", "C"], [30_000, 10_000, 0], [0, 0, 20_000], 13_000, readings)
    sent = a.credits.periods[arc.as_bytes32(pid)]
    check("posted with the rate per Wh (13000 per kWh -> 13)", sent["rate"] == 13 and tx.startswith("0x"), sent)
    check("energy passed through as real Wh", sent["unused"] == {"A": 30_000, "B": 10_000, "C": 0} and sent["over"]["C"] == 20_000)
    tx = a.fund_credits(pid, 140_000)
    check("fund approves then funds in base units", a.allowances == [140_000] and a.credits.sent == ["postPeriod", "fund"])
    st = a.credits_status(pid)
    check("pool 0.14 USDC", st["total_in_usdc"] == 0.14, st)
    check("A can claim 3x B", st["flats"]["A"]["claimable_usdc"] == 0.105 and st["flats"]["B"]["claimable_usdc"] == 0.035, st["flats"])
    check("C owes 20 kWh x 0.013 = 0.26", abs(st["flats"]["C"]["owes_usdc"] - 0.26) < 1e-9, st["flats"]["C"])
    check("rate reported back per kWh", st["neighbor_rate"] == 13_000)
    check("an unregistered wallet shows as None", st["flats"]["C"]["wallet"] is None and st["flats"]["A"]["wallet"])
    try:
        a.post_credits(arc.credit_period_id("x"), ["A"], [5], [3], 13_000, readings)
        check("a flat both under and over is refused before sending", False)
    except ValueError:
        check("a flat both under and over is refused before sending", True)
    try:
        a.post_credits(arc.credit_period_id("y"), ["A", "B"], [5], [0, 0], 13_000, readings)
        check("length mismatch refused before sending", False)
    except ValueError:
        check("length mismatch refused before sending", True)
    check("nothing extra was sent", a.credits.sent == ["postPeriod", "fund"], a.credits.sent)

    print("arc credits: all checks passed")


if __name__ == "__main__":
    main()
