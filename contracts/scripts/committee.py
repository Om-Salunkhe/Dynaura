"""Hand the three contracts to the society committee, so the Pi (oracle) is not also the owner.

    pip install "web3>=7" python-dotenv
    python contracts/scripts/committee.py --env path/to/arc.env

The env file needs ARC_ORACLE_PRIVATE_KEY (today's owner, the Pi), ARC_COMMITTEE_PRIVATE_KEY and
ARC_CLEANER_ADDRESS. Keys are never printed. Safe to run again: each step is skipped once done.

1. Gas money (USDC is the gas on Arc): the Pi tops the committee up to 1 USDC and the cleaner to 3 USDC.
2. Ownable2Step: the Pi calls transferOwnership(committee) on each contract, then the committee
   calls acceptOwnership(). From then on only the committee can resolve disputes or change the oracle.
"""
import argparse
import json
from pathlib import Path

from dotenv import dotenv_values
from eth_account import Account
from web3 import Web3

HERE = Path(__file__).resolve().parent.parent
USDC_ABI = [
    {"type": "function", "name": "balanceOf", "stateMutability": "view", "inputs": [{"name": "a", "type": "address"}], "outputs": [{"type": "uint256"}]},
    {"type": "function", "name": "transfer", "stateMutability": "nonpayable", "inputs": [{"name": "t", "type": "address"}, {"name": "v", "type": "uint256"}], "outputs": [{"type": "bool"}]},
]
TARGETS = {"committee": 1_000_000, "cleaner": 3_000_000}  # USDC, 6 decimals
MIN_FEE = Web3.to_wei(20, "gwei")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", required=True)
    ap.add_argument("--deployments", default=str(HERE / "deployments.json"))
    args = ap.parse_args()
    env = dotenv_values(args.env)
    dep_path = Path(args.deployments)
    dep = json.loads(dep_path.read_text())
    w3 = Web3(Web3.HTTPProvider(dep["rpc"], request_kwargs={"timeout": 30}))
    assert w3.eth.chain_id == dep["chainId"], "wrong chain"
    pi = Account.from_key(env["ARC_ORACLE_PRIVATE_KEY"])
    committee = Account.from_key(env["ARC_COMMITTEE_PRIVATE_KEY"])
    cleaner = Web3.to_checksum_address(env["ARC_CLEANER_ADDRESS"])
    usdc = w3.eth.contract(address=dep["usdc"], abi=USDC_ABI)
    link = lambda h: f"{dep['explorer']}/tx/{h}"
    txs: dict[str, str] = {}

    def send(acct, fn, label):
        tx = fn.build_transaction({
            "from": acct.address, "chainId": dep["chainId"],
            "nonce": w3.eth.get_transaction_count(acct.address, "pending"),
            "maxPriorityFeePerGas": Web3.to_wei(1, "gwei"),
            "maxFeePerGas": max(2 * w3.eth.get_block("latest")["baseFeePerGas"], MIN_FEE) + Web3.to_wei(1, "gwei"),
        })
        tx["gas"] = int(w3.eth.estimate_gas(tx) * 1.25)
        h = w3.eth.send_raw_transaction(acct.sign_transaction(tx).raw_transaction)
        r = w3.eth.wait_for_transaction_receipt(h, timeout=120)
        hx = "0x" + r["transactionHash"].hex().removeprefix("0x")
        if r["status"] != 1:
            raise SystemExit(f"{label} reverted: {link(hx)}")
        txs[label] = hx
        print(f"  {label:<34} {link(hx)}")

    print(f"Pi/oracle  {pi.address}: {usdc.functions.balanceOf(pi.address).call() / 1e6} USDC")
    print(f"Committee  {committee.address}")
    for who, addr in (("committee", committee.address), ("cleaner", cleaner)):
        have = usdc.functions.balanceOf(addr).call()
        if have < TARGETS[who]:
            send(pi, usdc.functions.transfer(addr, TARGETS[who] - have), f"fund {who} {(TARGETS[who] - have) / 1e6} USDC")
        else:
            print(f"  {who} already has {have / 1e6} USDC")

    for name in ("CleaningEscrow", "ShopTrade", "SolarBilling"):
        abi = json.loads((HERE / "abi" / f"{name}.json").read_text())
        c = w3.eth.contract(address=Web3.to_checksum_address(dep[name]["address"]), abi=abi)
        owner = c.functions.owner().call()
        if owner == committee.address:
            print(f"  {name}: already owned by the committee")
            continue
        if owner != pi.address:
            raise SystemExit(f"{name} is owned by {owner}, not the Pi: stopping")
        if c.functions.pendingOwner().call() != committee.address:
            send(pi, c.functions.transferOwnership(committee.address), f"{name}.transferOwnership")
        send(committee, c.functions.acceptOwnership(), f"{name}.acceptOwnership")
        assert c.functions.owner().call() == committee.address

    dep["owner"] = committee.address
    dep["committee"] = committee.address
    if txs:
        dep.setdefault("demoTxs", {})["committee"] = {**dep.get("demoTxs", {}).get("committee", {}), **txs}
    dep_path.write_text(json.dumps(dep, indent=2) + "\n")
    print("Done: the committee owns all three contracts; the Pi stays the oracle.")


if __name__ == "__main__":
    main()
