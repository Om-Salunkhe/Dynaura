"""Uploads each decision's episode log to 0G Storage, keeps the root hash, and indexes it on 0G Chain.

Uses the Go CLI:  0g-storage-client upload --url <rpc> --key <key> --indexer <indexer> --file <path>
When the upload is done it logs "file uploaded, root = 0x...", which we save on the decision
(and later on Arkiv). Then EpisodeRegistry.record(root, request_id, ai) puts it on 0G Chain.

Runs in the background so a slow upload never blocks the building. The episodes/ folder is the
offline queue: when 0G or the internet is down, uploads wait and are retried with backoff, and
they go out by themselves once it is back (the "reconnect" beat of the offline demo).
Anything still waiting is picked up again after a restart.
"""
import hashlib
import json
import logging
import queue
import random
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path

import config
import zg

log = logging.getLogger("dynaura.0g-storage")
EPISODES = Path(__file__).resolve().parent / "episodes"
# Only the final line counts: the CLI also logs "root=0x..." while it computes the Merkle root,
# before anything is uploaded, so a failed upload would otherwise look like a success.
ROOT_RE = re.compile(r"file uploaded, root = (0x[0-9a-fA-F]{64})")
RETRY_S = (10, 20, 40, 60)  # wait after 1, 2, 3, 4+ failures in a row (plus jitter)
MAX_PENDING = 500


class Uploader:
    def __init__(self, store, on_root=None, registry=None):
        self.store = store
        # callback(decision_id, root or None). None once, after the first failed upload, so the
        # decision still reaches Arkiv; called again with the root when a retry gets it through.
        self.on_root = on_root
        self.registry = registry  # zg_registry.Registry, or None
        self.snapshot = None  # callable -> what the building looked like (meters, relays, pump)
        self._write_lock = threading.Lock()
        self._last: tuple[int, str] | None = None  # (decision id, sha256) of the last episode file
        self.q: queue.Queue[int] = queue.Queue()
        self._lock = threading.Lock()
        self._pending: dict[int, str | None] = {}  # decision id -> record() tx that may still land
        self._told_none: set[int] = set()
        self._failures = 0
        self._next_try = 0.0
        self._warned_not_ready = False
        self.last_error: str | None = None
        EPISODES.mkdir(exist_ok=True)
        self._resume()
        threading.Thread(target=self._run, name="0g-storage", daemon=True).start()

    def ready(self) -> bool:
        key = config.ZG_PRIVATE_KEY.removeprefix("0x")
        return bool(shutil.which(config.ZG_STORAGE_CLI)) and len(key) == 64

    def enqueue(self, decision_id: int, extra: dict | None = None) -> None:
        """Write the episode file and queue it. The file holds the decision, its 0G proof (request ID,
        provider, TEE check, latency), the building at that moment, and the hash of the episode before,
        so the logs form a chain where a missing or edited one shows up."""
        d = self.store.decision(decision_id)
        if not d:
            return
        episode = {"dynaura_episode": 2, **d, "zg": zg.proof_for(d.get("request_id"))}
        if self.snapshot:
            try:
                episode["building"] = self.snapshot()
            except Exception as e:
                log.warning("building snapshot for episode #%s failed: %s", decision_id, e)
        with self._write_lock:
            episode["prev"] = self._prev(decision_id)
            episode.update(extra or {})
            text = json.dumps(episode, indent=2, default=str)
            (EPISODES / f"decision-{decision_id}.json").write_text(text)
            self._last = (decision_id, hashlib.sha256(text.encode()).hexdigest())
        self.q.put(decision_id)

    def _prev(self, decision_id: int) -> dict | None:
        """The episode written before this one: its decision id, file sha256 and (once uploaded) root."""
        if self._last is None or self._last[0] >= decision_id:
            ids = sorted(int(f.stem.split("-")[1]) for f in EPISODES.glob("decision-*.json")
                         if f.stem.split("-")[1].isdigit() and int(f.stem.split("-")[1]) < decision_id)
            if not ids:
                return None
            body = (EPISODES / f"decision-{ids[-1]}.json").read_bytes()
            self._last = (ids[-1], hashlib.sha256(body).hexdigest())
        prev_id, digest = self._last
        row = self.store.decision(prev_id) or {}
        return {"decision_id": prev_id, "sha256": digest, "storage_root": row.get("storage_root")}

    def retry_now(self) -> dict:
        """Try the waiting uploads now instead of at the next backoff step (demo: after reconnecting)."""
        with self._lock:
            self._next_try = 0.0
        self.q.put(0)  # wake the worker
        return self.status()

    def status(self) -> dict:
        with self._lock:
            pending = sorted(self._pending)
            wait = max(0.0, self._next_try - time.time()) if pending else 0.0
        return {"ready": self.ready(), "pending": len(pending), "pending_ids": pending[:20],
                "failures": self._failures, "next_try_s": round(wait), "last_error": self.last_error,
                "registry": config.ZG_REGISTRY or None,
                "registry_on": bool(self.registry and self.registry.enabled)}

    def upload(self, path: Path) -> str:
        cmd = [config.ZG_STORAGE_CLI, "upload", "--url", config.ZG_RPC, "--key", config.ZG_PRIVATE_KEY,
               "--indexer", config.ZG_INDEXER, "--file", str(path)]
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        out = p.stdout + p.stderr
        m = ROOT_RE.search(out)
        if p.returncode != 0 or not m:
            raise RuntimeError(f"upload failed (exit {p.returncode}): {out[-300:]}")
        return m.group(1)

    # ---- queue -----------------------------------------------------------
    def _resume(self) -> None:
        """After a restart: requeue recent episodes that never reached 0G Storage or the registry."""
        registry_on = bool(self.registry and self.registry.enabled)
        for d in self.store.decisions(limit=50):
            if not (EPISODES / f"decision-{d['id']}.json").exists():
                continue
            if not d.get("storage_root") or (registry_on and not d.get("episode_n")):
                self._pending[d["id"]] = None
        if self._pending:
            self._next_try = time.time() + 10  # let api.py wire on_root first
            log.info("%d episode(s) still waiting for 0G from before the restart", len(self._pending))

    def _run(self) -> None:
        while True:
            with self._lock:
                wait = min(5.0, max(0.2, self._next_try - time.time())) if self._pending else 5.0
            try:
                new = self.q.get(timeout=wait)
            except queue.Empty:
                new = None
            with self._lock:
                if new:
                    self._pending.setdefault(new, None)
                    while len(self._pending) > MAX_PENDING:  # the file stays on disk
                        self._pending.pop(min(self._pending))
                due = bool(self._pending) and (new is not None or time.time() >= self._next_try)
                ids = ([new] if new else []) + sorted(i for i in self._pending if i != new)
            if due:
                self._flush(ids)

    def _flush(self, ids: list[int]) -> None:
        """Newest first, then oldest to newest. A failed upload stops the round (0G Storage or the
        internet is probably down); a failed chain record only keeps that episode waiting."""
        failed = False
        for did in ids:
            result = self._process(did)
            if result == "done":
                with self._lock:
                    self._pending.pop(did, None)
                continue
            failed = True
            if result == "upload":
                break
        with self._lock:
            if failed:
                self._failures += 1
                step = RETRY_S[min(self._failures, len(RETRY_S)) - 1]
                self._next_try = time.time() + step * random.uniform(1.0, 1.2)
            else:
                self._failures = 0
                self.last_error = None

    def _process(self, did: int) -> str:
        """Upload one episode and record it on chain. Returns "done", "upload" (upload failed)
        or "chain" (on 0G Storage, but not yet on EpisodeRegistry)."""
        d = self.store.decision(did)
        path = EPISODES / f"decision-{did}.json"
        if not d or not path.exists():
            return "done"  # nothing to upload
        root = d.get("storage_root")
        if not root:
            if not self.ready():
                if not self._warned_not_ready:
                    self._warned_not_ready = True
                    log.warning("0G Storage not set up (CLI on PATH + 64-hex ZG_PRIVATE_KEY); "
                                "episodes stay in pi/episodes/ until it is")
                return "done"  # Arkiv got the decision straight away (api.py); a restart requeues it
            try:
                root = self.upload(path)
            except Exception as e:
                self.last_error = f"#{did}: {str(e)[:200]}"
                log.warning("0G Storage upload of #%s failed, will retry: %s", did, self.last_error)
                if did not in self._told_none:
                    self._told_none.add(did)
                    self._callback(did, None)
                return "upload"
            self.store.set_decision(did, storage_root=root)
            log.info("decision #%s on 0G Storage: %s", did, root)
            self._callback(did, root)

        if self.registry and self.registry.enabled and not d.get("episode_n"):
            from zg_registry import RegistryPending
            try:
                n, tx = self.registry.record(root, d.get("request_id"), d.get("mode") == "ai", self._pending.get(did))
            except RegistryPending as e:
                with self._lock:
                    self._pending[did] = e.tx  # never resend while it can still land
                self.last_error = f"#{did}: {e}"
                return "chain"
            except Exception as e:
                self.last_error = f"#{did}: EpisodeRegistry: {str(e)[:200]}"
                log.warning("EpisodeRegistry.record for #%s failed, will retry: %s", did, self.last_error)
                return "chain"
            self.store.set_decision(did, episode_n=n, episode_tx=tx)
        return "done"

    def _callback(self, did: int, root: str | None) -> None:
        if self.on_root:
            try:
                self.on_root(did, root)
            except Exception:
                log.exception("on_root callback failed")
