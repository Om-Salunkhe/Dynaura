"""Offline test of the 0G episode queue (pi/og_storage.py): no network, no wallet.

A fake 0g-storage-client fails while "offline" (after logging the Merkle root, like the real CLI)
and succeeds once "online". A fake registry stands in for EpisodeRegistry.

Run from pi/:  python tests/test_episode_queue.py
"""
import os
import stat
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config  # noqa: E402

TMP = Path(tempfile.mkdtemp(prefix="dynaura-episodes-"))
ONLINE = TMP / "online"
ROOT = "0x" + "ab" * 32
CLI = TMP / "fake-0g-storage-client"
CLI.write_text(f"""#!/bin/sh
echo 'level=info msg="Data merkle root calculated" root={ROOT}' >&2
if [ ! -f "{ONLINE}" ]; then echo 'level=fatal msg="Failed to upload file" error="dial tcp: no route to host"' >&2; exit 1; fi
echo 'level=info msg="file uploaded, root = {ROOT}"' >&2
""")
CLI.chmod(CLI.stat().st_mode | stat.S_IEXEC)
config.ZG_STORAGE_CLI = str(CLI)
config.ZG_PRIVATE_KEY = "0x" + "11" * 32

import og_storage  # noqa: E402
from store import Store  # noqa: E402
from zg_registry import RegistryPending  # noqa: E402

og_storage.EPISODES = TMP / "episodes"
og_storage.RETRY_S = (0.2, 0.2, 0.2, 0.2)


class FakeRegistry:
    enabled = True

    def __init__(self):
        self.calls = []
        self.fail_next = 0
        self.pending_next = 0
        self.pending_args = None

    def record(self, root, chat_id, ai, sent_tx=None):
        self.calls.append((root, chat_id, ai, sent_tx))
        if self.pending_next:
            self.pending_next -= 1
            self.pending_args = (root, chat_id, ai)
            raise RegistryPending("0xfeed")
        if self.fail_next:
            self.fail_next -= 1
            raise RuntimeError("rpc down")
        return len(self.calls), "0xabc"


def wait_for(cond, timeout=10.0):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.05)
    return False


def main():
    store = Store(str(TMP / "test.db"))
    reg = FakeRegistry()
    roots = []
    up = og_storage.Uploader(store, on_root=lambda did, root: roots.append((did, root)), registry=reg)

    # 1. Offline: the CLI logs a root but fails. Nothing may be recorded as uploaded.
    did = store.add_decision("plan", "no-ai", "0G unreachable", {"reason": "offline"})
    up.enqueue(did)
    assert wait_for(lambda: up.status()["failures"] >= 1), up.status()
    assert store.decision(did)["storage_root"] is None, "failed upload must not get a root"
    assert roots == [(did, None)], roots  # Arkiv still gets the decision, once
    assert up.status()["pending"] == 1

    # 2. More decisions while offline queue up behind it; on_root(None) once per decision.
    did2 = store.add_decision("plan", "ai", "plan", {}, request_id="chat-123")
    reg.pending_next = 1  # the first record() after reconnecting is sent but not mined yet
    up.enqueue(did2)
    assert wait_for(lambda: (did2, None) in roots), roots
    assert wait_for(lambda: up.status()["failures"] >= 2)
    assert roots.count((did, None)) == 1, roots

    # 3. Back online: everything goes out by itself, in order, and lands on the registry.
    ONLINE.touch()
    up.retry_now()
    assert wait_for(lambda: up.status()["pending"] == 0), up.status()
    for d in (did, did2):
        row = store.decision(d)
        assert row["storage_root"] == ROOT, row
        assert row["episode_n"] and row["episode_tx"] == "0xabc", row
        assert (d, ROOT) in roots, roots
    # no-AI episode recorded with ai=False and no chat ID; the AI one with its request ID
    assert (ROOT, None, False, None) in reg.calls, reg.calls
    assert (ROOT, "chat-123", True, None) in reg.calls, reg.calls
    # the episode whose tx was pending is retried with that tx (checked, never blindly resent)
    assert reg.pending_args + ("0xfeed",) in reg.calls, reg.calls
    assert up.status()["failures"] == 0 and up.status()["last_error"] is None

    # 4. A registry failure keeps only that episode waiting; it does not block uploads.
    did3 = store.add_decision("ask", "ai", "q", {}, request_id="chat-456")
    reg.fail_next = 1
    up.enqueue(did3)
    assert wait_for(lambda: store.decision(did3)["storage_root"] == ROOT)
    assert wait_for(lambda: store.decision(did3)["episode_n"] is not None, timeout=5), up.status()

    # 5. Restart: an episode that never got uploaded is picked up again.
    ONLINE.unlink()
    did4 = store.add_decision("plan", "ai", "plan", {}, request_id="chat-789")
    up.enqueue(did4)
    assert wait_for(lambda: up.status()["failures"] >= 1)
    up2 = og_storage.Uploader(store, registry=reg)
    assert did4 in up2.status()["pending_ids"], up2.status()
    ONLINE.touch()
    up2.retry_now()
    assert wait_for(lambda: store.decision(did4)["episode_n"] is not None), up2.status()

    print("episode queue: all checks passed", flush=True)
    os._exit(0)  # the worker threads are daemons that never end


if __name__ == "__main__":
    main()
