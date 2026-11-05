"""Local tests for the three Arc contracts on an in-memory EVM.

    cd contracts && npm install && npm run build
    pip install "web3>=7" "eth-tester[py-evm]"
    python test/test_contracts.py
"""
import json
from pathlib import Path

from web3 import EthereumTesterProvider, Web3
from eth_tester.exceptions import TransactionFailed
from web3.exceptions import ContractLogicError

BUILD = Path(__file__).resolve().parent.parent / "build"
w3 = Web3(EthereumTesterProvider())
tester = w3.provider.ethereum_tester
admin, oracle, society, cleaner, shop, resident, stranger = w3.eth.accounts[:7]
USDC = 10**6


def deploy(name, *args, sender=admin):
    art = json.loads((BUILD / f"{name}.json").read_text())
    c = w3.eth.contract(abi=art["abi"], bytecode=art["bytecode"])
    rcpt = w3.eth.wait_for_transaction_receipt(c.constructor(*args).transact({"from": sender}))
    return w3.eth.contract(address=rcpt.contractAddress, abi=art["abi"])


def tx(fn, sender):
    return w3.eth.wait_for_transaction_receipt(fn.transact({"from": sender}))


def reverts(fn, sender, sel: bytes):
    """The call must revert with the custom error whose 4-byte selector is `sel`."""
    try:
        fn.call({"from": sender})
    except (ContractLogicError, TransactionFailed) as e:
        text = f"{e} {getattr(e, 'data', '')}"
        assert sel.hex() in text or repr(sel)[2:-1] in text, f"expected {sel.hex()}, got {text}"
        return
    raise AssertionError(f"expected revert {sel.hex()}")


def now():
    return w3.eth.get_block("latest")["timestamp"]


def warp(seconds):
    tester.time_travel(now() + seconds)
    tester.mine_blocks()


def selector(sig):
    return bytes(Web3.keccak(text=sig)[:4])


usdc = deploy("MockUSDC")
for who in (society, shop, resident):
    tx(usdc.functions.mint(who, 100 * USDC), admin)
bal = lambda a: usdc.functions.balanceOf(a).call()


def test_escrow():
    esc = deploy("CleaningEscrow", usdc.address, oracle)
    tx(usdc.functions.approve(esc.address, 10 * USDC), society)
    tx(esc.functions.openJob(2 * USDC, now() + 3600, 52), society)
    assert bal(esc.address) == 2 * USDC
    reverts(esc.functions.release(1, 95, b"\x01" * 32), oracle, selector("BadStatus()"))  # not accepted yet
    tx(esc.functions.accept(1), cleaner)
    reverts(esc.functions.accept(1), stranger, selector("BadStatus()"))
    reverts(esc.functions.release(1, 95, b"\x01" * 32), stranger, selector("NotOracle()"))
    reverts(esc.functions.release(1, 80, b"\x01" * 32), oracle, selector("NotClean(uint16)"))
    reverts(esc.functions.refund(1), stranger, selector("TooEarly()"))
    tx(esc.functions.release(1, 96, b"\x01" * 32), oracle)
    assert bal(cleaner) == 2 * USDC and bal(esc.address) == 0
    job = esc.functions.jobs(1).call()
    assert job[6] == 3 and job[5] == 96  # Paid, outputAfter

    # second job: nobody cleans, refund after deadline
    before = bal(society)
    tx(esc.functions.openJob(1 * USDC, now() + 60, 50), society)
    tx(esc.functions.accept(2), cleaner)
    warp(120)
    reverts(esc.functions.release(2, 95, b"\x00" * 32), oracle, selector("TooLate()"))
    tx(esc.functions.refund(2), stranger)
    assert bal(society) == before
    print("escrow ok")


def test_shop():
    st = deploy("ShopTrade", usdc.address, oracle, society, 80_000)  # 0.08 USDC / kWh
    assert st.functions.costOf(1500).call() == 120_000  # 1.5 kWh -> 0.12 USDC
    tx(usdc.functions.approve(st.address, 10 * USDC), shop)
    s0, t0 = bal(shop), bal(society)
    tx(st.functions.placeOrder("2026-11-06", 1500, now() + 3600), shop)
    assert bal(st.address) == 120_000
    reverts(st.functions.settle(1, 1000), stranger, selector("NotOracle()"))
    tx(st.functions.settle(1, 1000), oracle)  # only 1 kWh delivered
    assert bal(society) - t0 == 80_000 and s0 - bal(shop) == 80_000
    reverts(st.functions.settle(1, 1000), oracle, selector("BadStatus()"))

    tx(st.functions.placeOrder("2026-11-06", 500, now() + 60), shop)
    tx(st.functions.settle(2, 9999), oracle)  # over-report is capped at the order
    assert st.functions.orders(2).call()[3] == 500

    tx(st.functions.placeOrder("2026-11-07", 500, now() + 60), shop)
    reverts(st.functions.refund(3), shop, selector("TooEarly()"))
    warp(120)
    reverts(st.functions.refund(3), stranger, selector("NotShop()"))
    before = bal(shop)
    tx(st.functions.refund(3), shop)
    assert bal(shop) - before == 40_000
    print("shop ok")


if __name__ == "__main__":
    test_escrow()
    test_shop()
    print("all contract tests passed")
