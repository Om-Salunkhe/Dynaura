"""Device key that signs every 1-minute summary.

Anyone can check a summary came from this Pi with verify(). The key comes
from DEVICE_PRIVATE_KEY in .env, or is created once in pi/.device_key.
"""
import json
import os
from pathlib import Path

from eth_account import Account
from eth_account.messages import encode_defunct

KEY_FILE = Path(__file__).resolve().parent / ".device_key"
SIGNED_FIELDS = ("minute", "meter", "avg_w", "wh", "solar_wh", "samples")


def _load_key(env_key: str) -> str:
    if env_key:
        key = env_key.removeprefix("0x")
        if len(key) != 64:
            raise ValueError(f"DEVICE_PRIVATE_KEY must be 64 hex characters, got {len(key)}")
        return "0x" + key
    if KEY_FILE.exists():
        return KEY_FILE.read_text().strip()
    acct = Account.create()
    KEY_FILE.write_text(acct.key.hex())
    os.chmod(KEY_FILE, 0o600)
    return KEY_FILE.read_text().strip()


def message_for(summary: dict) -> str:
    payload = {k: summary[k] for k in SIGNED_FIELDS}
    return "dynaura:" + json.dumps(payload, sort_keys=True, separators=(",", ":"))


class DeviceSigner:
    def __init__(self, env_key: str = ""):
        self._acct = Account.from_key(_load_key(env_key))

    @property
    def address(self) -> str:
        return self._acct.address

    def sign(self, summary: dict) -> dict:
        msg = encode_defunct(text=message_for(summary))
        sig = self._acct.sign_message(msg).signature.hex()
        return {**summary, "signer": self.address, "sig": sig if sig.startswith("0x") else "0x" + sig}


def verify(summary: dict) -> bool:
    msg = encode_defunct(text=message_for(summary))
    return Account.recover_message(msg, signature=summary["sig"]) == summary["signer"]
