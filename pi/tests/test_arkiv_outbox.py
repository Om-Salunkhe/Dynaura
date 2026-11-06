"""Offline test of the durable Arkiv outbox (pi/arkiv.py): no bridge, no network.

A fake bridge (httpx.MockTransport) can be "down" (connection refused) or answer any status.
It checks the 6 Nov outage can't lose records again: writes made while the bridge is down wait in
the outbox, survive a Pi restart, and go out in order once the bridge is back.

Run from pi/:  python tests/test_arkiv_outbox.py
"""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402

import config  # noqa: E402

config.ARKIV_BRIDGE_URL = "http://bridge.test"
from arkiv import ArkivQueue  # noqa: E402

TMP = Path(tempfile.mkdtemp(prefix="dynaura-outbox-"))


class FakeBridge:
    def __init__(self):
        self.up = False
        self.status = 200  # what a POST answers while up
        self.got: list[tuple[str, dict]] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if not self.up:
            raise httpx.ConnectError("connection refused", request=request)
        body = json.loads(request.content or b"{}")
        if self.status != 200:
            return httpx.Response(self.status, json={"error": "nope"})
        self.got.append((request.url.path, body))
        return httpx.Response(200, json={"key": body.get("arkiv_key") or f"0xkey{len(self.got)}"})


class FakeStore:
    def __init__(self):
        self.rows = {1: {"id": 1, "kind": "plan", "mode": "ai", "request_id": "zg-1", "model": "m",
                         "storage_root": None, "summary": "plan", "ts": 1_799_990_000, "arkiv_key": None}}

    def decision(self, did):
        return dict(self.rows[did]) if did in self.rows else None

    def set_decision(self, did, **fields):
        self.rows[did].update(fields)

    def daily(self, n):
        return []


def queue(name, bridge, store=None, **kw):
    http = httpx.Client(transport=httpx.MockTransport(bridge))
    return ArkivQueue(store or FakeStore(), outbox_path=str(TMP / f"{name}.db"), http=http, **kw)


def drain(q, now=10**10):
    for _ in range(100):
        if not q.step(now=now):
            return


def test_outage_then_recovery_in_order():
    bridge = FakeBridge()
    q = queue("outage", bridge)
    q.on_summaries([{"minute": 60}])
    q.decision(1)
    q.post("/cleaning_job", {"job_id": 7, "status": "flagged"})
    q.post("/cleaning_job", {"job_id": 7, "status": "approved"})
    q.step(now=0)  # bridge down: nothing lost
    assert q.backlog()["waiting"] == 4, q.backlog()
    bridge.up = True
    drain(q)
    assert [p for p, _ in bridge.got] == ["/readings", "/decision", "/cleaning_job", "/cleaning_job"]
    assert [b.get("status") for p, b in bridge.got if p == "/cleaning_job"] == ["flagged", "approved"], "order kept"
    assert q.backlog()["waiting"] == 0 and q.ok


def test_survives_a_pi_restart():
    bridge = FakeBridge()
    q1 = queue("restart", bridge)
    q1.post("/maintenance", {"title": "Panel cleaned"})
    q1.step(now=0)  # down
    q2 = queue("restart", bridge)  # same outbox file, new process
    bridge.up = True
    drain(q2)
    assert bridge.got == [("/maintenance", {"title": "Panel cleaned"})]


def test_late_root_is_read_at_send_time():
    bridge = FakeBridge()
    store = FakeStore()
    q = queue("root", bridge, store)
    q.decision(1)  # queued without a root while the bridge is down
    store.set_decision(1, storage_root="0xroot", arkiv_key="0xexisting")
    bridge.up = True
    drain(q)
    body = bridge.got[0][1]
    assert body["og_storage_root"] == "0xroot" and body["arkiv_key"] == "0xexisting", body


def test_what_the_bridge_says_decides():
    for status, kept in [(503, True), (500, True), (429, True), (502, False), (400, False), (409, False)]:
        bridge = FakeBridge()
        bridge.up, bridge.status = True, status
        q = queue(f"status{status}", bridge)
        q.post("/bill", {"flat": "A"})
        q.step(now=0)
        assert (q.backlog()["waiting"] == 1) is kept, (status, q.backlog())
        if kept:  # backing off: not resent before its time
            q.step(now=0)
            bridge.status = 200
            drain(q)
            assert bridge.got and q.backlog()["waiting"] == 0, status


def test_heartbeats_are_live_only_and_daily_coalesces():
    bridge = FakeBridge()
    q = queue("hb", bridge)
    q.post("/heartbeat", {"mode": "plan"})
    q.post("/daily", {"day": "2026-11-06", "panel_wh": 1})
    q.post("/daily", {"day": "2026-11-06", "panel_wh": 2})
    q.step(now=0)  # down
    assert q.backlog()["waiting"] == 1, "one daily row per day, no heartbeat stored"
    bridge.up = True
    q.post("/heartbeat", {"mode": "no-ai"})
    drain(q)
    assert bridge.got == [("/heartbeat", {"mode": "no-ai"}), ("/daily", {"day": "2026-11-06", "panel_wh": 2})], bridge.got


def test_bounded_sheds_oldest_readings_never_decisions():
    bridge = FakeBridge()
    q = queue("bound", bridge, max_rows=3)
    q.decision(1)
    for m in range(5):
        q.on_summaries([{"minute": m}])
    b = q.backlog()
    assert b["waiting"] == 3 and b["dropped"] == 3, b
    bridge.up = True
    drain(q)
    assert bridge.got[0][0] == "/decision", "the decision survived"
    assert [b["summaries"][0]["minute"] for p, b in bridge.got if p == "/readings"] == [3, 4], "newest readings kept"


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"ok  {t.__name__}")
    print(f"{len(tests)} passed")
