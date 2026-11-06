"""End-to-end run on Arc testnet against the deployed contracts (addresses from deployments.json).

    pip install "web3>=7" python-dotenv
    python contracts/scripts/e2e.py --env path/to/arc.env [--root 0x<0G storage root>] [--request-id <0G request id>]

The env file needs ARC_ORACLE_PRIVATE_KEY (the Pi wallet: oracle and treasury),
ARC_CLEANER_PRIVATE_KEY and, for the dispute, ARC_COMMITTEE_PRIVATE_KEY (the owner, after
scripts/committee.py). Keys are never printed.

1. Escrow: the Pi locks a small fee (with the 0G request ID), the cleaner accepts, the Pi links the
   0G episode root and releases the fee with a meter proof (panel back at 95%).
2. Dispute: another job; the cleaner disputes it ("cloudy"), and the committee wallet (not the Pi)
   resolves it by paying the cleaner.
3. Billing: the Pi posts a test bill for flat "E2E" and the cleaner wallet pays it as the resident.
   The solar part goes to the treasury and the grid part to the grid payee, in one transaction.

Every transaction is printed as an explorer link and saved under "demoTxs" in deployments.json.
"""
import argparse
import json
import time
from pathlib import Path

from dotenv import dotenv_values
from eth_account import Account
from web3 import Web3

HERE = Path(__file__).resolve().parent.parent
DEPLOY = HERE / "deployments.json"
ERC20 = [
    {"type": "function", "name": "balanceOf", "stateMutability": "view", "inputs": [{"name": "a", "type": "address"}], "outputs": [{"type": "uint256"}]},
    {"type": "function", "name": "approve", "stateMutability": "nonpayable", "inputs": [{"name": "s", "type": "address"}, {"name": "v", "type": "uint256"}], "outputs": [{"type": "bool"}]},
    {"type": "function", "name": "transfer", "stateMutability": "nonpayable", "inputs": [{"name": "t", "type": "address"}, {"name": "v", "type": "uint256"}], "outputs": [{"type": "bool"}]},
]
STATUS = ["none", "open", "accepted", "paid", "refunded", "cancelled", "disputed"]
MIN_FEE = Web3.to_wei(20, "gwei")  # Arc drops anything under the 20 gwei base fee, silently


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", required=True, help="file with ARC_ORACLE_PRIVATE_KEY and ARC_CLEANER_PRIVATE_KEY")
    ap.add_argument("--fee", type=float, default=0.5, help="escrow fee in USDC")
    ap.add_argument("--request-id", default="", help="0G request ID of the panel_dirty decision")
    ap.add_argument("--root", default="", help="0G Storage root of the episode (0x + 64 hex)")
    ap.add_argument("--skip-bill", action="store_true")
    ap.add_argument("--skip-dispute", action="store_true")
    ap.add_argument("--deployments", default=str(DEPLOY), help="deployments.json to read and update")
    args = ap.parse_args()

    env = dotenv_values(args.env)
    dep_path = Path(args.deployments)
    dep = json.loads(dep_path.read_text())
    w3 = Web3(Web3.HTTPProvider(dep["rpc"], request_kwargs={"timeout": 30}))
    assert w3.eth.chain_id == dep["chainId"], "wrong chain"
    pi = Account.from_key(env["ARC_ORACLE_PRIVATE_KEY"])
    cleaner = Account.from_key(env["ARC_CLEANER_PRIVATE_KEY"])
    abi = lambda n: json.loads((HERE / "abi" / f"{n}.json").read_text())
    usdc = w3.eth.contract(address=dep["usdc"], abi=ERC20)
    esc = w3.eth.contract(address=dep["CleaningEscrow"]["address"], abi=abi("CleaningEscrow"))
    bill = w3.eth.contract(address=dep["SolarBilling"]["address"], abi=abi("SolarBilling"))
    assert esc.functions.oracle().call() == pi.address, "the env's oracle key is not the escrow's oracle"
    link = lambda h: f"{dep['explorer']}/tx/{h}"
    txs: dict[str, str] = {}

    def send(acct, fn, label: str) -> dict:
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
        print(f"  {label:<16} {link(hx)}")
        return r

    usd = lambda units: f"{units / 1e6:.6f} USDC"
    print(f"Pi/oracle {pi.address}: {usd(usdc.functions.balanceOf(pi.address).call())}")
    print(f"Cleaner   {cleaner.address}: {usd(usdc.functions.balanceOf(cleaner.address).call())}")
    if usdc.functions.balanceOf(cleaner.address).call() < 1_000_000:  # gas money for accept (USDC is the gas)
        send(pi, usdc.functions.transfer(cleaner.address, 2_000_000), "fund cleaner")

    # ---- 1. escrow: dusty panel -> locked fee -> accepted -> released on clean proof ----
    fee = int(round(args.fee * 1e6))
    job_id = esc.functions.nextJobId().call()
    request_id = args.request_id or f"e2e-{int(time.time())}"
    print(f"\nCleaningEscrow {esc.address}: job #{job_id}")
    send(pi, usdc.functions.approve(esc.address, fee), "approve fee")
    deadline = int(time.time()) + 20 * 60
    send(pi, esc.functions.openJob(fee, deadline, 48, request_id), "openJob")
    send(cleaner, esc.functions.accept(job_id), "accept")
    root = bytes.fromhex(args.root.removeprefix("0x")) if args.root else Web3.keccak(text=f"dynaura e2e episode {request_id}")
    send(pi, esc.functions.linkEpisode(job_id, root), "linkEpisode")
    before = usdc.functions.balanceOf(cleaner.address).call()
    proof = Web3.keccak(text=f"dynaura e2e meter readings {request_id}")
    send(pi, esc.functions.release(job_id, 95, proof), "release")
    got = usdc.functions.balanceOf(cleaner.address).call() - before
    j = esc.functions.jobs(job_id).call()
    print(f"  job #{job_id}: {STATUS[j[6]]}, output {j[4]}% -> {j[5]}%, cleaner received {usd(got)}, 0G request {j[9]}")
    assert STATUS[j[6]] == "paid" and got == fee

    # ---- 2. dispute: the cleaner disputes, the committee (not the Pi) resolves ----
    if not args.skip_dispute and env.get("ARC_COMMITTEE_PRIVATE_KEY"):
        committee = Account.from_key(env["ARC_COMMITTEE_PRIVATE_KEY"])
        assert esc.functions.owner().call() == committee.address, "the committee must own the escrow (scripts/committee.py)"
        job2 = esc.functions.nextJobId().call()
        print(f"\nDispute: job #{job2}")
        send(pi, usdc.functions.approve(esc.address, fee), "approve fee 2")
        send(pi, esc.functions.openJob(fee, int(time.time()) + 20 * 60, 47, f"{request_id}-d"), "openJob 2")
        send(cleaner, esc.functions.accept(job2), "accept 2")
        send(cleaner, esc.functions.dispute(job2, "Cleaned it, but it is cloudy: the meter can't show it yet"), "dispute")
        try:
            send(pi, esc.functions.resolve(job2, True), "resolve by the Pi")
            raise SystemExit("the Pi could resolve a dispute: it must not")
        except SystemExit:
            raise
        except Exception:
            print("  resolve by the Pi       refused, as it should be (only the committee resolves)")
        before = usdc.functions.balanceOf(cleaner.address).call()
        send(committee, esc.functions.resolve(job2, True), "resolve (committee)")
        got = usdc.functions.balanceOf(cleaner.address).call() - before
        j = esc.functions.jobs(job2).call()
        print(f"  job #{job2}: {STATUS[j[6]]}, the committee paid the cleaner {usd(got)}")
        assert STATUS[j[6]] == "paid" and got == fee

    # ---- 3. billing: one payment, split by where the power came from ----
    if not args.skip_bill:
        month = time.strftime("e2e-%H%M%S")  # unique, at most 16 bytes
        bill_id = bill.functions.nextBillId().call()
        print(f"\nSolarBilling {bill.address}: bill #{bill_id} (flat E2E, {month})")
        send(pi, bill.functions.postBill("E2E", month, cleaner.address, 150_000, 50_000, 1875, 250, Web3.keccak(text=month)), "postBill")
        grid = bill.functions.gridPayee().call()
        g0 = usdc.functions.balanceOf(grid).call()
        send(cleaner, usdc.functions.approve(bill.address, 200_000), "approve bill")
        send(cleaner, bill.functions.pay(bill_id), "pay (split)")
        print(f"  grid payee {grid} received {usd(usdc.functions.balanceOf(grid).call() - g0)}; treasury got the solar part")

    dep.setdefault("demoTxs", {})[time.strftime("%Y-%m-%dT%H:%M:%S")] = txs
    dep_path.write_text(json.dumps(dep, indent=2) + "\n")
    print("\nSaved to deployments.json (demoTxs).")


if __name__ == "__main__":
    main()
