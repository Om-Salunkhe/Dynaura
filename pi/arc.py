"""Arc testnet: the Pi wallet is the oracle of the contracts in contracts/.
It opens and releases cleaning escrows, settles shop orders, posts monthly bills and posts each
period's fair-share credits, always from what its own meters measured. USDC is both the money and
the gas on Arc."""
import hashlib
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
JOB_STATUS = ["none", "open", "accepted", "paid", "refunded", "cancelled", "disputed"]
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
        # Unset contracts are None, so need() answers ArcUnavailable (never AttributeError) on a Pi
        # without an Arc key or without one of the addresses.
        self.escrow = self.shop = self.billing = self.credits = None
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
        self.credits = self._contract("SolarCredits", config.ARC_CREDITS)

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
    def open_cleaning(self, fee_usdc: float, deadline: int, output_pct: float, og_request_id: str = "") -> tuple[int, str]:
        """og_request_id: the 0G request ID of the AI decision that flagged the panel (stored on chain)."""
        esc = self.need(self.escrow)
        units = to_units(fee_usdc)
        self.ensure_allowance(esc.address, units)
        pct = max(0, min(100, int(round(output_pct))))
        rcpt = self.send(esc.functions.openJob(units, int(deadline), pct, (og_request_id or "")[:128]))
        ev = esc.events.JobOpened().process_receipt(rcpt)[0]
        return ev["args"]["jobId"], self.tx_hash(rcpt)

    def job(self, job_id: int) -> dict:
        j = self.need(self.escrow).functions.jobs(job_id).call()
        return {"job_id": job_id, "payer": j[0], "cleaner": j[1], "fee_usdc": from_units(j[2]), "deadline": j[3],
                "output_before": j[4], "output_after": j[5], "status": JOB_STATUS[j[6]],
                "proof": "0x" + j[7].hex() if any(j[7]) else None,
                "og_storage_root": "0x" + j[8].hex() if any(j[8]) else None, "og_request_id": j[9] or None}

    def release_cleaning(self, job_id: int, output_pct: float, proof: bytes) -> str:
        rcpt = self.send(self.need(self.escrow).functions.release(job_id, min(100, int(output_pct)), proof))
        return self.tx_hash(rcpt)

    def link_episode(self, job_id: int, root: str) -> str:
        """Attach the 0G Storage root of the episode behind the job (once per job)."""
        return self.tx_hash(self.send(self.need(self.escrow).functions.linkEpisode(job_id, bytes.fromhex(root.removeprefix("0x")))))

    def cancel_cleaning(self, job_id: int) -> str:
        return self.tx_hash(self.send(self.need(self.escrow).functions.cancel(job_id)))

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
                "solar_wh": x[4], "grid_wh": x[5], "readings_hash": "0x" + x[6].hex(), "paid": x[7], "paid_by": x[8],
                "solar_usdc": from_units(x[9]), "grid_usdc": from_units(x[10])}

    def post_bill(self, flat: str, month: str, resident: str | None, solar_usdc: float, grid_usdc: float,
                  solar_wh: int, grid_wh: int, readings_hash: bytes) -> tuple[int, str]:
        """On payment the solar part goes to the society treasury, the grid part to the grid payee."""
        b = self.need(self.billing)
        resident = Web3.to_checksum_address(resident) if resident else "0x" + "00" * 20
        rcpt = self.send(b.functions.postBill(flat, month, resident, to_units(solar_usdc), to_units(grid_usdc),
                                              int(solar_wh), int(grid_wh), readings_hash))
        return b.events.BillPosted().process_receipt(rcpt)[0]["args"]["billId"], self.tx_hash(rcpt)

    # ---- solar credits (fair share of the spare sun) ---------------------
    # pi/credits.py (dy-arkiv) works out each flat's unused and over-share energy for a period;
    # SolarCredits then pays each flat pool * unusedWh / sum(unusedWh) itself. Units on chain: energy
    # in Wh of the real building (round(model Wh * BILL_SCALE)), money in USDC base units (6 decimals).
    def post_credits(self, period_id, flats: list[str], unused_wh: list[int], over_wh: list[int],
                     neighbor_rate: int, readings_hash) -> str:
        """Post one period (oracle, once). neighbor_rate is in USDC base units per real kWh
        (13000 = 0.013 USDC/kWh); the contract takes it per Wh, so it is divided by 1000 here."""
        c = self.need(self.credits)
        if not (len(flats) == len(unused_wh) == len(over_wh)):
            raise ValueError("flats, unused_wh and over_wh must have the same length")
        for f, u, o in zip(flats, unused_wh, over_wh):
            if u > 0 and o > 0:
                raise ValueError(f"flat {f} can't be both under its share and over it")
        rate = int(round(int(neighbor_rate) / 1000))
        if rate * 1000 != int(neighbor_rate):
            log.warning("neighbour rate %s per kWh rounded to %s per Wh on chain", neighbor_rate, rate)
        rcpt = self.send(c.functions.postPeriod(as_bytes32(period_id), list(flats), [int(x) for x in unused_wh],
                                                [int(x) for x in over_wh], rate, as_bytes32(readings_hash)))
        return self.tx_hash(rcpt)

    def fund_credits(self, period_id, amount: int) -> str:
        """Put shop and grid revenue (USDC base units) into the period's pool. The Pi is the treasury."""
        c = self.need(self.credits)
        self.ensure_allowance(c.address, int(amount))
        return self.tx_hash(self.send(c.functions.fund(as_bytes32(period_id), int(amount))))

    def claim_credits(self, period_id, flat: str) -> str:
        """Pay a flat its share now. Anyone may trigger it: the USDC goes to the flat's registered wallet."""
        c = self.need(self.credits)
        return self.tx_hash(self.send(c.functions.claim(as_bytes32(period_id), flat)))

    def credits_status(self, period_id) -> dict:
        """What SolarCredits holds for one period: posted?, the pool, and per flat what's claimable/claimed."""
        c = self.need(self.credits)
        pid = as_bytes32(period_id)
        posted, rate, rhash, total_unused, total_in, total_claimed = c.functions.periodInfo(pid).call()
        out = {"period_id": "0x" + pid.hex(), "posted": posted, "neighbor_rate": rate * 1000,
               "readings_hash": "0x" + bytes(rhash).hex(), "total_unused_wh": total_unused,
               "total_in_usdc": from_units(total_in), "total_claimed_usdc": from_units(total_claimed), "flats": {}}
        if not posted:
            return out
        for flat in c.functions.flatsOf(pid).call():
            _, unused, over, paid_in, claimed = c.functions.flatInfo(pid, flat).call()
            wallet = c.functions.walletOf(flat).call()
            out["flats"][flat] = {"unused_wh": unused, "over_wh": over, "paid_in": paid_in,
                                  "owes_usdc": from_units(over * rate), "claimed_usdc": from_units(claimed),
                                  "claimable_usdc": from_units(c.functions.claimable(pid, flat).call()),
                                  "wallet": None if int(wallet, 16) == 0 else wallet}
        return out

    def credit_claims(self, period_id) -> dict:
        """{flat: tx of its latest claim, or None}, from CreditClaimed events (best effort)."""
        return self.credit_txs(period_id)["claims"]

    def credit_txs(self, period_id) -> dict:
        """The period's post / fund / claim transactions from SolarCredits' events. One event type per
        query: Arc's RPC refuses eth_getLogs filtered on several event types."""
        out = {"post_tx": None, "fund_tx": None, "claims": {}}
        c = self.credits
        if not (self.enabled and c is not None):
            return out
        pid = as_bytes32(period_id)
        try:
            for name, slot in (("PeriodPosted", "post_tx"), ("PeriodFunded", "fund_tx"), ("CreditClaimed", "claims")):
                for ev in getattr(c.events, name)().get_logs(from_block=config.ARC_CREDITS_FROM_BLOCK,
                                                             argument_filters={"periodId": pid}):
                    h = ev["transactionHash"].hex()
                    h = h if h.startswith("0x") else "0x" + h
                    if slot == "claims":
                        out["claims"][ev["args"]["flat"]] = h
                    else:
                        out[slot] = h
        except Exception as e:
            log.warning("SolarCredits event lookup failed: %s", str(e)[:200])
        return out


def credit_period_id(key: str) -> str:
    """bytes32 id of a credits period, as pi/credits.py makes it: sha256("dynaura-credits:<key>"),
    key "2026-11-07" for a day."""
    return "0x" + hashlib.sha256(f"dynaura-credits:{key}".encode()).hexdigest()


def as_bytes32(h) -> bytes:
    """bytes32 from 32 bytes or 0x-hex."""
    b = bytes.fromhex(h[2:] if h.startswith("0x") else h) if isinstance(h, str) else bytes(h or b"")
    if len(b) != 32:
        raise ValueError("expected 32 bytes (a period id or a readings hash)")
    return b
