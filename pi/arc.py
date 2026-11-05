"""Arc testnet: the Pi wallet is the oracle of the three contracts in contracts/.
It opens and releases cleaning escrows, settles shop orders and posts monthly bills,
always from what its own meters measured. USDC is both the money and the gas on Arc."""
import json
import logging
import threading

from eth_account import Account
from web3 import Web3

import config

log = logging.getLogger("dynaura.arc")

USDC_DECIMALS = 6
ABI_DIR = config.ROOT / "contracts" / "abi"
ERC20_ABI = [
    {"type": "function", "name": "balanceOf", "stateMutability": "view",
     "inputs": [{"name": "a", "type": "address"}], "outputs": [{"name": "", "type": "uint256"}]},
    {"type": "function", "name": "allowance", "stateMutability": "view",
     "inputs": [{"name": "o", "type": "address"}, {"name": "s", "type": "address"}],
     "outputs": [{"name": "", "type": "uint256"}]},
    {"type": "function", "name": "approve", "stateMutability": "nonpayable",
     "inputs": [{"name": "s", "type": "address"}, {"name": "v", "type": "uint256"}],
     "outputs": [{"name": "", "type": "bool"}]},
]
JOB_STATUS = ["none", "open", "accepted", "paid", "refunded"]
ORDER_STATUS = ["none", "open", "settled", "refunded"]


def to_units(usdc: float) -> int:
    return int(round(float(usdc) * 10**USDC_DECIMALS))


def from_units(units: int) -> float:
    return units / 10**USDC_DECIMALS


class ArcUnavailable(RuntimeError):
    pass


class Arc:
    def __init__(self):
        self.enabled = bool(config.ARC_PRIVATE_KEY)
        self._lock = threading.Lock()  # one transaction at a time keeps the nonce simple
        if not self.enabled:
            log.info("Arc is off (no ARC_PRIVATE_KEY)")
            return
        self.w3 = Web3(Web3.HTTPProvider(config.ARC_RPC_URL, request_kwargs={"timeout": 20}))
        self.account = Account.from_key(config.ARC_PRIVATE_KEY)
        self.address = self.account.address
        self.usdc = self.w3.eth.contract(address=Web3.to_checksum_address(config.ARC_USDC), abi=ERC20_ABI)
        self.escrow = self._contract("CleaningEscrow", config.ARC_ESCROW)
        self.shop = self._contract("ShopTrade", config.ARC_SHOP)
        self.billing = self._contract("SolarBilling", config.ARC_BILLING)

    def _contract(self, name: str, address: str):
        if not address:
            return None
        abi = json.loads((ABI_DIR / f"{name}.json").read_text())
        return self.w3.eth.contract(address=Web3.to_checksum_address(address), abi=abi)

    def need(self, contract):
        if not self.enabled or contract is None:
            raise ArcUnavailable("Arc is not set up: add ARC_PRIVATE_KEY and the contract addresses to .env")
        return contract

    # ---- sending ---------------------------------------------------------
    def _fees(self) -> dict:
        base = self.w3.eth.get_block("latest").get("baseFeePerGas") or self.w3.eth.gas_price
        floor = Web3.to_wei(config.ARC_MIN_FEE_GWEI, "gwei")
        tip = Web3.to_wei(1, "gwei")
        return {"maxFeePerGas": max(2 * base + tip, floor), "maxPriorityFeePerGas": tip}

    def send(self, fn) -> dict:
        """Sign, send and wait for one contract call. Returns the receipt (raises if it reverted)."""
        with self._lock:
            tx = fn.build_transaction({
                "from": self.address,
                "chainId": config.ARC_CHAIN_ID,
                "nonce": self.w3.eth.get_transaction_count(self.address, "pending"),
                **self._fees(),
            })
            tx["gas"] = int(self.w3.eth.estimate_gas(tx) * 1.25)
            signed = self.account.sign_transaction(tx)
            h = self.w3.eth.send_raw_transaction(signed.raw_transaction)
            rcpt = self.w3.eth.wait_for_transaction_receipt(h, timeout=90)
            if rcpt["status"] != 1:
                raise RuntimeError(f"Arc tx reverted: {h.hex()}")
            log.info("Arc tx %s ok", rcpt["transactionHash"].hex())
            return rcpt

    @staticmethod
    def tx_hash(rcpt) -> str:
        h = rcpt["transactionHash"].hex()
        return h if h.startswith("0x") else "0x" + h

    def balance(self) -> float:
        return from_units(self.usdc.functions.balanceOf(self.address).call())

    def ensure_allowance(self, spender: str, units: int) -> None:
        if self.usdc.functions.allowance(self.address, spender).call() < units:
            self.send(self.usdc.functions.approve(spender, 2**256 - 1))

    # ---- cleaning escrow -------------------------------------------------
    def open_cleaning(self, fee_usdc: float, deadline: int, output_pct: float) -> tuple[int, str]:
        esc = self.need(self.escrow)
        units = to_units(fee_usdc)
        self.ensure_allowance(esc.address, units)
        rcpt = self.send(esc.functions.openJob(units, int(deadline), int(round(output_pct))))
        ev = esc.events.JobOpened().process_receipt(rcpt)[0]
        return ev["args"]["jobId"], self.tx_hash(rcpt)

    def job(self, job_id: int) -> dict:
        j = self.need(self.escrow).functions.jobs(job_id).call()
        return {"job_id": job_id, "payer": j[0], "cleaner": j[1], "fee_usdc": from_units(j[2]), "deadline": j[3],
                "output_before": j[4], "output_after": j[5], "status": JOB_STATUS[j[6]]}

    def release_cleaning(self, job_id: int, output_pct: float, proof: bytes) -> str:
        rcpt = self.send(self.need(self.escrow).functions.release(job_id, int(output_pct), proof))
        return self.tx_hash(rcpt)

    def refund_cleaning(self, job_id: int) -> str:
        return self.tx_hash(self.send(self.need(self.escrow).functions.refund(job_id)))

    # ---- shop trade --------------------------------------------------------
    def next_order_id(self) -> int:
        return self.need(self.shop).functions.nextOrderId().call()

    def order(self, order_id: int) -> dict:
        o = self.need(self.shop).functions.orders(order_id).call()
        return {"order_id": order_id, "shop": o[0], "deposit_usdc": from_units(o[1]), "want_wh": o[2],
                "delivered_wh": o[3], "price_per_kwh": from_units(o[4]), "deadline": o[5],
                "status": ORDER_STATUS[o[6]], "day": o[7]}

    def settle_order(self, order_id: int, delivered_wh: int) -> tuple[float, float, str]:
        shop = self.need(self.shop)
        rcpt = self.send(shop.functions.settle(order_id, int(delivered_wh)))
        ev = shop.events.OrderSettled().process_receipt(rcpt)[0]["args"]
        return from_units(ev["paid"]), from_units(ev["refunded"]), self.tx_hash(rcpt)

    def set_price(self, usdc_per_kwh: float) -> str:
        return self.tx_hash(self.send(self.need(self.shop).functions.setPrice(to_units(usdc_per_kwh))))

    # ---- solar billing -----------------------------------------------------
    def bill_id(self, flat: str, month: str) -> int:
        b = self.need(self.billing)
        return b.functions.billOf(b.functions.key(flat, month).call()).call()

    def bill(self, bill_id: int) -> dict:
        x = self.need(self.billing).functions.bills(bill_id).call()
        return {"bill_id": bill_id, "flat": x[0], "month": x[1], "resident": x[2], "usdc": from_units(x[3]),
                "solar_wh": x[4], "grid_wh": x[5], "readings_hash": "0x" + x[6].hex(), "paid": x[7], "paid_by": x[8]}

    def post_bill(self, flat: str, month: str, resident: str | None, usdc: float, solar_wh: int, grid_wh: int,
                  readings_hash: bytes) -> tuple[int, str]:
        b = self.need(self.billing)
        resident = Web3.to_checksum_address(resident) if resident else "0x" + "00" * 20
        rcpt = self.send(b.functions.postBill(flat, month, resident, to_units(usdc), int(solar_wh), int(grid_wh), readings_hash))
        return b.events.BillPosted().process_receipt(rcpt)[0]["args"]["billId"], self.tx_hash(rcpt)
