"""Uploads each decision's episode log to 0G Storage and keeps the root hash.

Uses the Go CLI:  0g-storage-client upload --url <rpc> --key <key> --indexer <indexer> --file <path>
It prints "... root = 0x..." which we save on the decision (and later on Arkiv).
Runs in the background so a slow upload never blocks the building.
"""
import json
import logging
import queue
import re
import shutil
import subprocess
import threading
from pathlib import Path

import config

log = logging.getLogger("dynaura.0g-storage")
EPISODES = Path(__file__).resolve().parent / "episodes"
ROOT_RE = re.compile(r"root\s*[=:]\s*(0x[0-9a-fA-F]{64})")


class Uploader:
    def __init__(self, store, on_root=None):
        self.store = store
        self.on_root = on_root  # callback(decision_id, root or None when the upload failed)
        self.q: queue.Queue[int] = queue.Queue()
        EPISODES.mkdir(exist_ok=True)
        threading.Thread(target=self._run, name="0g-storage", daemon=True).start()

    def ready(self) -> bool:
        key = config.ZG_PRIVATE_KEY.removeprefix("0x")
        return bool(shutil.which(config.ZG_STORAGE_CLI)) and len(key) == 64

    def enqueue(self, decision_id: int, extra: dict | None = None) -> None:
        d = next((x for x in self.store.decisions(limit=50) if x["id"] == decision_id), None)
        if not d:
            return
        path = EPISODES / f"decision-{decision_id}.json"
        path.write_text(json.dumps({"dynaura_episode": 1, **d, **(extra or {})}, indent=2, default=str))
        self.q.put(decision_id)

    def upload(self, path: Path) -> str:
        cmd = [config.ZG_STORAGE_CLI, "upload", "--url", config.ZG_RPC, "--key", config.ZG_PRIVATE_KEY,
               "--indexer", config.ZG_INDEXER, "--file", str(path)]
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        out = p.stdout + p.stderr
        m = ROOT_RE.search(out)
        if not m:
            raise RuntimeError(f"no root in CLI output (exit {p.returncode}): {out[-400:]}")
        return m.group(1)

    def _run(self) -> None:
        while True:
            did = self.q.get()
            if not self.ready():
                log.warning("0G Storage not set up (CLI on PATH + 64-hex ZG_PRIVATE_KEY); kept decision-%s.json locally", did)
                continue
            try:
                root = self.upload(EPISODES / f"decision-{did}.json")
                self.store.set_decision(did, storage_root=root)
                log.info("decision #%s on 0G Storage: %s", did, root)
                if self.on_root:
                    self.on_root(did, root)
            except Exception as e:
                log.warning("0G Storage upload of #%s failed: %s", did, e)
                if self.on_root:
                    self.on_root(did, None)
