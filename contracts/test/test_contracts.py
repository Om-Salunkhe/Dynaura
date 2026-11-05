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


if __name__ == "__main__":
    test_escrow()
    print("all contract tests passed")
