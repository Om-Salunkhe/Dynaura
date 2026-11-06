"""Arc testnet: the Pi wallet is the oracle of the contracts in contracts/.
It opens and releases cleaning escrows, settles shop orders, posts monthly bills and posts each
period's fair-share credits, always from what its own meters measured. USDC is both the money and
the gas on Arc."""
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
    # On chain, energy is in Wh of the real building (1 Wh on the model = BILL_SCALE Wh real) and the
    # neighbour rate in micro-USDC per real Wh (0.013 USDC/kWh -> 13). SolarCredits then pays each flat
    # pool * unusedWh / sum(unusedWh) itself.
    def credits_post(self, key: str, flats: dict, neighbor_rate_usdc: float, readings_hash) -> str:
        """Post one period (oracle). flats = {"A": {"unused_wh": 30, "over_wh": 0}, ...} in model Wh,
        the shape of GET /api/credits. A period is posted once; posting it again reverts."""
        c = self.need(self.credits)
        names, unused, over = credit_rows(flats)
        rcpt = self.send(c.functions.postPeriod(credit_period_id(key), names, unused, over,
                                                rate_to_chain(neighbor_rate_usdc), as_bytes32(readings_hash)))
        return self.tx_hash(rcpt)

    def credits_fund(self, key: str, usdc: float) -> str:
        """Put shop and grid revenue into the period's pool (the Pi is the society treasury)."""
        c = self.need(self.credits)
        units = to_units(usdc)
        self.ensure_allowance(c.address, units)
        return self.tx_hash(self.send(c.functions.fund(credit_period_id(key), units)))

    def credits_claim(self, key: str, flat: str) -> str:
        """Pay a flat its share now. Anyone may trigger it: the USDC goes to the flat's registered wallet."""
        c = self.need(self.credits)
        return self.tx_hash(self.send(c.functions.claim(credit_period_id(key), flat)))

    def credits_status(self, key: str) -> dict:
        """What SolarCredits holds for one period: posted?, the pool, and per flat what is claimable/claimed."""
        c = self.need(self.credits)
        pid = credit_period_id(key)
        posted, rate, rhash, total_unused, total_in, total_claimed = c.functions.periodInfo(pid).call()
        out = {"period_id": pid, "key": key, "posted": posted, "neighbor_rate_usdc": rate / 1000,
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

    def credits_settle(self, key: str, flats: dict, neighbor_rate_usdc: float, fund_usdc: float,
                       readings_hash) -> dict:
        """POST /api/admin/credits/settle: post the period (once) and fund it with the shop and grid
        revenue (only what the Pi hasn't put in yet). Safe to call again. Returns the API's chain{}."""
        st = self.credits_status(key)
        post_tx = fund_tx = None
        if not st["posted"]:
            post_tx = self.credits_post(key, flats, neighbor_rate_usdc, readings_hash)
            st = self.credits_status(key)
        paid_in = sum(f["owes_usdc"] for f in st["flats"].values() if f["paid_in"])
        missing = round(fund_usdc - (st["total_in_usdc"] - paid_in), 6)
        if missing >= 1e-6 and st["total_unused_wh"] > 0:
            fund_tx = self.credits_fund(key, missing)
            st = self.credits_status(key)
        txs = self.credits_txs(key)
        return {**st, "post_tx": post_tx or txs["post_tx"], "fund_tx": fund_tx or txs["fund_tx"],
                "claims": {f: txs["claims"].get(f) for f in st["flats"]}}

    def credits_txs(self, key: str) -> dict:
        """Best effort: the period's transactions from SolarCredits' events (one event type per query:
        Arc's RPC refuses eth_getLogs filtered on several event types)."""
        out = {"post_tx": None, "fund_tx": None, "claims": {}}
        c = self.credits
        if not (self.enabled and c is not None):
            return out
        pid = credit_period_id(key)
        try:
            frm = max(config.ARC_CREDITS_FROM_BLOCK, 0)
            for name, slot in (("PeriodPosted", "post_tx"), ("PeriodFunded", "fund_tx"), ("CreditClaimed", "claims")):
                ev = getattr(c.events, name)()
                for log_ in ev.get_logs(from_block=frm, argument_filters={"periodId": pid}):
                    h = log_["transactionHash"].hex()
                    h = h if h.startswith("0x") else "0x" + h
                    if slot == "claims":
                        out["claims"][log_["args"]["flat"]] = h  # the latest claim per flat
                    else:
                        out[slot] = h  # the latest post / fund
        except Exception as e:
            log.warning("SolarCredits event lookup failed: %s", str(e)[:200])
        return out


def credit_period_id(key: str) -> str:
    """bytes32 id of a credits period: keccak256("<building>:<key>"), key "2026-11-07" (day) or "2026-11" (month)."""
    h = Web3.keccak(text=f"{config.BUILDING_ID}:{key}").hex()
    return h if h.startswith("0x") else "0x" + h


def wh_to_chain(wh_model: float) -> int:
    """Model Wh -> Wh of the real building (BILL_SCALE 1000: 1 Wh on the model is 1 kWh real)."""
    return int(round(max(float(wh_model or 0), 0.0) * config.BILL_SCALE))


def rate_to_chain(usdc_per_kwh: float) -> int:
    """USDC per real kWh -> micro-USDC per real Wh (0.013 -> 13)."""
    return int(round(float(usdc_per_kwh) * 1000))


def as_bytes32(h) -> bytes:
    b = bytes.fromhex(h[2:] if h.startswith("0x") else h) if isinstance(h, str) else bytes(h or b"")
    if len(b) != 32:
        raise ValueError("readings_hash must be 32 bytes")
    return b


def credit_rows(flats: dict) -> tuple[list[str], list[int], list[int]]:
    """Sorted flat names with their unused and over-share energy on chain. A flat is under its share
    or over it, never both (the contract refuses that), so only the larger of the two is kept."""
    names, unused, over = [], [], []
    for flat in sorted(flats):
        u, o = wh_to_chain(flats[flat].get("unused_wh")), wh_to_chain(flats[flat].get("over_wh"))
        names.append(flat)
        unused.append(u if u >= o else 0)
        over.append(o if o > u else 0)
    return names, unused, over
