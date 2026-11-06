"""Sends records to the Arkiv bridge in the background. Arkiv never blocks the building.

Every record waits in a small SQLite outbox (arkiv_outbox.db) until the bridge has accepted it.
A bridge that is down or restarting only delays records; it no longer drops them. (On 6 Nov the
bridge was down from 18:49 to 22:36, and every decision, root patch and reading of that time was
lost, because the old in-memory queue dropped a write that failed.) The outbox survives a Pi
restart too.

- Order is kept: the oldest record goes first, so a cleaning job's transitions arrive in order.
- Heartbeats are the exception: a late heartbeat means nothing, so only the newest one is sent,
  live, and it is never stored.
- Daily totals coalesce: only the newest totals of a day wait in the outbox.
- What the bridge says decides a retry:
  - unreachable, a timeout, 429, 500 or 503 (busy, or Arkiv down): retry with backoff, keep the
    record;
  - 502 (the write was sent but its outcome is unknown): drop it, never resend (the bridge
    reconciles and shows it in /health);
  - 400, 404, 409 or 413 (it can't ever succeed): drop it and log.
- It is bounded: past MAX_ROWS (about a week of readings), the oldest *readings* are shed first;
  decisions, jobs and bills never are.
"""
import json
import logging
import os
import random
import sqlite3
import threading
import time
from datetime import datetime

import httpx

import config

log = logging.getLogger("dynaura.arkiv")

OUTBOX_PATH = os.getenv("ARKIV_OUTBOX_PATH", "arkiv_outbox.db")
MAX_ROWS = int(os.getenv("ARKIV_OUTBOX_MAX", "10000"))
TIMEOUT_S = 120  # the bridge gives one write up to 45 s, plus its own queue
RETRY = {429, 500, 503}  # busy, Arkiv down, queue full: try again later
DROP = {400, 404, 409, 413}  # this request can never succeed


class ArkivQueue:
    def __init__(self, store, loop=None, runner=None, *, outbox_path: str | None = None,
                 http: httpx.Client | None = None, max_rows: int | None = None):
        self.store = store
        self.loop = loop
        self.runner = runner
        self.url = config.ARKIV_BRIDGE_URL.rstrip("/")
        self.ok = False
        self.last_error = None
        self.dropped = 0  # records given up on (see the module doc for when)
        self._http = http or httpx.Client(timeout=TIMEOUT_S)
        self._max_rows = max_rows or MAX_ROWS
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._heartbeat: dict | None = None
        self._db = sqlite3.connect(outbox_path or OUTBOX_PATH, check_same_thread=False, isolation_level=None)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("""CREATE TABLE IF NOT EXISTS outbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL,
            body TEXT NOT NULL,
            coalesce_key TEXT,
            created REAL NOT NULL,
            tries INTEGER NOT NULL DEFAULT 0,
            next_at REAL NOT NULL DEFAULT 0,
            last_error TEXT)""")

    # ---- producers -------------------------------------------------------
    def post(self, path: str, body: dict) -> None:
        if path == "/heartbeat":  # live only: the newest replaces any unsent one
            self._heartbeat = body
            self._wake.set()
            return
        key = f"daily:{body.get('day')}" if path == "/daily" else None
        with self._lock:
            if key:
                self._db.execute("DELETE FROM outbox WHERE coalesce_key = ?", (key,))
            self._db.execute("INSERT INTO outbox (path, body, coalesce_key, created) VALUES (?, ?, ?, ?)",
                             (path, json.dumps(body), key, time.time()))
            over = self._db.execute("SELECT COUNT(*) FROM outbox").fetchone()[0] - self._max_rows
            if over > 0:
                shed = self._db.execute("DELETE FROM outbox WHERE id IN (SELECT id FROM outbox WHERE path = '/readings' "
                                        "ORDER BY id LIMIT ?)", (over,)).rowcount
                if shed:
                    self.dropped += shed
                    log.warning("Arkiv outbox full: shed the %d oldest readings", shed)
        self._wake.set()

    def on_summaries(self, summaries: list[dict]) -> None:
        self.post("/readings", {"summaries": summaries})

    def decision_body(self, decision_id: int) -> dict | None:
        """The /decision body for one stored decision (also used by the backfill tool)."""
        d = self.store.decision(decision_id)
        if not d:
            return None
        return {
            "decision_id": d["id"], "kind": d["kind"], "mode": d["mode"],
            "request_id": d["request_id"], "model": d["model"], "storage_root": d["storage_root"],
            # final names (DECISIONS 01:30); the old ones stay until the bridge reads these
            "og_request_id": d["request_id"], "og_storage_root": d["storage_root"],
            "summary": d["summary"] or "", "day": datetime.fromtimestamp(d["ts"]).strftime("%Y-%m-%d"),
            "_decision_id": d["id"],
        }

    def decision(self, decision_id: int) -> None:
        body = self.decision_body(decision_id)
        if body:
            self.post("/decision", body)

    def send_now(self, path: str, body: dict) -> dict:
        """Write and wait for the result (for admin actions that show the Arkiv key)."""
        return self._send(path, dict(body))

    def backlog(self) -> dict:
        """For /api/health: how much is waiting, and for how long."""
        with self._lock:
            n, oldest = self._db.execute("SELECT COUNT(*), MIN(created) FROM outbox").fetchone()
        return {"waiting": n, "oldest_s": round(time.time() - oldest) if oldest else 0, "dropped": self.dropped}

    # ---- reads -----------------------------------------------------------
    def history(self, days: int = 7) -> list[dict]:
        r = self._http.get(f"{self.url}/history", params={"days": days}, timeout=15)
        r.raise_for_status()
        return r.json()

    # ---- worker ----------------------------------------------------------
    def _send(self, path: str, body: dict) -> dict:
        decision_id = body.pop("_decision_id", None)
        on_reply = body.pop("_on_reply", None)  # e.g. keep the Arkiv key of a cleaning job
        if path == "/decision" and decision_id:
            # Read at send time: the 0G Storage root may have come in while this waited in the outbox,
            # and a decision already on Arkiv gets the root patched in instead of a second entity.
            d = self.store.decision(decision_id) or {}
            body["storage_root"] = body["og_storage_root"] = d.get("storage_root") or body.get("storage_root")
            if d.get("arkiv_key"):
                body["arkiv_key"] = d["arkiv_key"]
        r = self._http.post(f"{self.url}{path}", json=body)
        r.raise_for_status()
        out = r.json()
        if decision_id and out.get("key"):
            self.store.set_decision(decision_id, arkiv_key=out["key"])
        if on_reply:
            try:
                on_reply(out)
            except Exception:
                log.exception("Arkiv reply callback failed")
        return out

    @staticmethod
    def _verdict(e: Exception) -> str:
        """retry | drop: what to do with a record whose send failed."""
        if isinstance(e, httpx.HTTPStatusError):
            code = e.response.status_code
            if code in RETRY or code >= 500 and code != 502:
                return "retry"
            return "drop"  # 502: sent, outcome unknown, never resend; 4xx: can't succeed
        if isinstance(e, httpx.TransportError):
            return "retry"  # bridge down, restarting, or slow
        return "drop"  # a bug in the record itself (e.g. not JSON-serialisable)

    def step(self, now: float | None = None) -> bool:
        """Send the live heartbeat, then the oldest record if it's due. True if anything was sent."""
        now = time.time() if now is None else now
        did = False
        hb, self._heartbeat = self._heartbeat, None
        if hb is not None:
            try:
                self._send("/heartbeat", hb)
                did = True
            except Exception as e:
                log.info("Arkiv heartbeat not sent: %s", str(e)[:120])  # the next one replaces it
        with self._lock:
            row = self._db.execute("SELECT id, path, body, tries, next_at FROM outbox ORDER BY id LIMIT 1").fetchone()
        if row is None or row[4] > now:
            return did  # empty, or the oldest record is backing off: keep the order, wait
        rid, path, body, tries, _ = row
        try:
            self._send(path, json.loads(body))
        except Exception as e:
            err = str(e)[:200]
            self.ok, self.last_error = False, err
            if self._verdict(e) == "retry":
                wait = min(300, 2 ** tries) * (0.5 + random.random())
                with self._lock:
                    self._db.execute("UPDATE outbox SET tries = tries + 1, next_at = ?, last_error = ? WHERE id = ?",
                                     (now + wait, err, rid))
                log.warning("Arkiv %s failed (try %d), retrying in %.0f s: %s", path, tries + 1, wait, err)
            else:
                with self._lock:
                    self._db.execute("DELETE FROM outbox WHERE id = ?", (rid,))
                self.dropped += 1
                log.error("Arkiv %s dropped, won't succeed or must not be resent: %s", path, err)
            return did
        with self._lock:
            self._db.execute("DELETE FROM outbox WHERE id = ?", (rid,))
        self.ok, self.last_error = True, None
        return True

    def _worker(self) -> None:
        while not self._stop.is_set():
            if not self.step():
                self._wake.wait(1)
                self._wake.clear()

    def _ticker(self) -> None:
        """Heartbeat every 30 s, today's totals every 10 min."""
        last_daily = 0.0
        while not self._stop.wait(30):
            st = self.loop.state if self.loop else {}
            self.post("/heartbeat", {
                "mode": (self.runner.status if self.runner else {}).get("mode", "unknown"),
                "flats": {f: v.get("source") for f, v in (st.get("flats") or {}).items()},
                "pump": (st.get("pump") or {}).get("on", False),
                "solar_w": st.get("solar_w", 0), "used_w": st.get("used_w", 0),
            })
            if time.time() - last_daily > 600:
                last_daily = time.time()
                for d in self.store.daily(1):
                    self.post("/daily", d)

    def start(self) -> None:
        threading.Thread(target=self._worker, name="arkiv-worker", daemon=True).start()
        threading.Thread(target=self._ticker, name="arkiv-ticker", daemon=True).start()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
