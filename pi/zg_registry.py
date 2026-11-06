"""EpisodeRegistry on 0G Chain (Galileo): the on-chain index of every episode log.

After an episode JSON is on 0G Storage, the Pi calls record(root, chatId, ai) from its 0G wallet
(ZG_PRIVATE_KEY, the same wallet that pays for Storage). The contract and its deploy script are in zerog/.

Retry-safe: episodeOf(root) says whether a root is already on chain, a sent transaction is never sent
again while it can still land, and the contract refuses the same root twice anyway.
"""
import json
import logging
import threading

from eth_account import Account
from web3 import Web3
from web3.exceptions import TimeExhausted, TransactionNotFound

import config

log = logging.getLogger("dynaura.0g-chain")
ABI = config.ROOT / "zerog" / "abi" / "EpisodeRegistry.json"


class RegistryPending(RuntimeError):
    """record() was sent but has not landed yet. Check again later; do not send it again."""

    def __init__(self, tx: str):
        super().__init__(f"record tx {tx} not mined yet")
        self.tx = tx


class Registry:
    def __init__(self):
        key = config.ZG_PRIVATE_KEY
        self.enabled = bool(config.ZG_REGISTRY) and len(key.removeprefix("0x")) == 64
        self.address = None
        self._lock = threading.Lock()  # one transaction at a time keeps the nonce simple
        if not self.enabled:
            log.info("EpisodeRegistry is off (needs ZG_REGISTRY and a 64-hex ZG_PRIVATE_KEY)")
            return
        self.w3 = Web3(Web3.HTTPProvider(config.ZG_RPC, request_kwargs={"timeout": 20}))
        self.account = Account.from_key(key)
        self.address = self.account.address
        self.contract = self.w3.eth.contract(address=Web3.to_checksum_address(config.ZG_REGISTRY),
                                             abi=json.loads(ABI.read_text()))

    def recorded(self, root: str) -> int:
        """Episode number of a 0G Storage root on chain (0 = not recorded yet)."""
        return self.contract.functions.episodeOf(Web3.to_bytes(hexstr=root)).call()

    def record(self, root: str, chat_id: str | None, ai: bool, sent_tx: str | None = None) -> tuple[int, str | None]:
        """Put one episode on chain. Returns (episode number, tx hash).
        sent_tx: a record() tx from an earlier try that may still land (from RegistryPending)."""
        with self._lock:
            n = self.recorded(root)
            if n:
                return n, sent_tx
            if sent_tx and self._in_flight(sent_tx):
                raise RegistryPending(sent_tx)
            fn = self.contract.functions.record(Web3.to_bytes(hexstr=root), chat_id or "", bool(ai))
            tx = fn.build_transaction({
                "from": self.address,
                "chainId": config.ZG_CHAIN_ID,
                "nonce": self.w3.eth.get_transaction_count(self.address, "pending"),
                "gasPrice": self.w3.eth.gas_price,
            })
            tx["gas"] = int(self.w3.eth.estimate_gas(tx) * 1.25)
            tx_hash = Web3.to_hex(self.w3.eth.send_raw_transaction(self.account.sign_transaction(tx).raw_transaction))
            try:
                rcpt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=45)
            except TimeExhausted:
                raise RegistryPending(tx_hash) from None
            if rcpt["status"] != 1:
                raise RuntimeError(f"EpisodeRegistry.record reverted: {tx_hash}")
            events = self.contract.events.Episode().process_receipt(rcpt)
            n = events[0]["args"]["n"] if events else self.recorded(root)
            log.info("episode %s on 0G Chain: root %s, tx %s", n, root, tx_hash)
            return n, tx_hash

    def _in_flight(self, tx_hash: str) -> bool:
        """True while a sent tx can still land (in the mempool, no receipt yet)."""
        try:
            self.w3.eth.get_transaction_receipt(tx_hash)
            return False  # mined; if it reverted, a new one may be sent
        except TransactionNotFound:
            pass
        try:
            self.w3.eth.get_transaction(tx_hash)
            return True
        except TransactionNotFound:
            return False  # dropped from the mempool: safe to send again
