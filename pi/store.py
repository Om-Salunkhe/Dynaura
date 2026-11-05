"""SQLite cache on the Pi.

- readings: one row per meter per second, kept 7 days
- summaries: one row per meter per minute (these go to Arkiv later)
"""
import sqlite3
import threading
import time

KEEP_SECONDS = 7 * 24 * 3600

SCHEMA = """
CREATE TABLE IF NOT EXISTS readings (
    ts     REAL NOT NULL,
    meter  TEXT NOT NULL,
    v      REAL NOT NULL,
    ma     REAL NOT NULL,
    w      REAL NOT NULL,
    source TEXT
);
CREATE INDEX IF NOT EXISTS readings_ts ON readings (ts);

CREATE TABLE IF NOT EXISTS summaries (
    minute  INTEGER NOT NULL,     -- unix time of the minute start
    meter   TEXT NOT NULL,
    avg_w   REAL NOT NULL,
    wh      REAL NOT NULL,
    solar_wh REAL NOT NULL,
    samples INTEGER NOT NULL,
    signer  TEXT,
    sig     TEXT,
    PRIMARY KEY (minute, meter)
);

CREATE TABLE IF NOT EXISTS decisions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ts           REAL NOT NULL,
    kind         TEXT NOT NULL,      -- plan | ask | dust | clean
    mode         TEXT NOT NULL,      -- ai | no-ai
    request_id   TEXT,               -- 0G ZG-Res-Key
    model        TEXT,
    tee          TEXT,               -- JSON of TEE fields from the Router
    summary      TEXT,
    input        TEXT,               -- prompt (JSON or text)
    output       TEXT,               -- JSON result
    storage_root TEXT,               -- 0G Storage root of the episode log
    arkiv_key    TEXT                -- Arkiv entity key, once written
);
"""


class Store:
    def __init__(self, path: str):
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            self._db.executescript(SCHEMA)
            # 0G Chain index of each episode (EpisodeRegistry), added to existing databases too
            cols = {r[1] for r in self._db.execute("PRAGMA table_info(decisions)")}
            for col, kind in (("episode_n", "INTEGER"), ("episode_tx", "TEXT")):
                if col not in cols:
                    self._db.execute(f"ALTER TABLE decisions ADD COLUMN {col} {kind}")
            self._db.commit()

    def add_readings(self, ts: float, rows: list[tuple[str, float, float, float, str | None]]) -> None:
        """rows: (meter, v, ma, w, source)"""
        with self._lock:
            self._db.executemany(
                "INSERT INTO readings (ts, meter, v, ma, w, source) VALUES (?, ?, ?, ?, ?, ?)",
                [(ts, *r) for r in rows],
            )
            self._db.commit()

    def add_summary(self, s: dict) -> None:
        with self._lock:
            self._db.execute(
                "INSERT OR REPLACE INTO summaries (minute, meter, avg_w, wh, solar_wh, samples, signer, sig)"
                " VALUES (:minute, :meter, :avg_w, :wh, :solar_wh, :samples, :signer, :sig)",
                {"signer": None, "sig": None, **s},
            )
            self._db.commit()

    def summaries(self, meter: str | None = None, since: int = 0, limit: int = 1440) -> list[dict]:
        q = "SELECT * FROM summaries WHERE minute >= ?"
        args: list = [since]
        if meter:
            q += " AND meter = ?"
            args.append(meter)
        q += " ORDER BY minute DESC LIMIT ?"
        args.append(limit)
        with self._lock:
            return [dict(r) for r in self._db.execute(q, args)]

    # ---- 0G decisions --------------------------------------------------
    def add_decision(self, kind: str, mode: str, summary: str, output: dict, *, request_id=None,
                     model=None, tee=None, input=None) -> int:
        import json
        with self._lock:
            cur = self._db.execute(
                "INSERT INTO decisions (ts, kind, mode, request_id, model, tee, summary, input, output)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (time.time(), kind, mode, request_id, model, json.dumps(tee or {}), summary,
                 input if isinstance(input, str) or input is None else json.dumps(input), json.dumps(output)),
            )
            self._db.commit()
            return cur.lastrowid

    def set_decision(self, decision_id: int, **fields) -> None:
        allowed = {"storage_root", "arkiv_key", "summary", "episode_n", "episode_tx"}
        sets = {k: v for k, v in fields.items() if k in allowed}
        if not sets:
            return
        with self._lock:
            self._db.execute(
                f"UPDATE decisions SET {', '.join(f'{k} = ?' for k in sets)} WHERE id = ?",
                (*sets.values(), decision_id),
            )
            self._db.commit()

    @staticmethod
    def _decision(row) -> dict:
        import json
        d = dict(row)
        d["tee"] = json.loads(d["tee"] or "{}")
        d["output"] = json.loads(d["output"] or "{}")
        return d

    def decisions(self, kind: str | None = None, limit: int = 20) -> list[dict]:
        q, args = "SELECT * FROM decisions", []
        if kind:
            q += " WHERE kind = ?"
            args.append(kind)
        q += " ORDER BY id DESC LIMIT ?"
        args.append(limit)
        with self._lock:
            return [self._decision(r) for r in self._db.execute(q, args)]

    def decision(self, decision_id: int) -> dict | None:
        with self._lock:
            row = self._db.execute("SELECT * FROM decisions WHERE id = ?", (decision_id,)).fetchone()
        return self._decision(row) if row else None

    def latest(self, kind: str) -> dict | None:
        rows = self.decisions(kind, 1)
        return rows[0] if rows else None

    # ---- daily totals for the planner and the app ------------------------
    def daily(self, days: int = 7) -> list[dict]:
        since = int(time.time()) - days * 86400
        q = """SELECT date(minute, 'unixepoch', 'localtime') AS day, meter,
                      SUM(wh) AS wh, SUM(solar_wh) AS solar_wh
               FROM summaries WHERE minute >= ? GROUP BY day, meter ORDER BY day"""
        with self._lock:
            rows = [dict(r) for r in self._db.execute(q, (since,))]
        out: dict[str, dict] = {}
        for r in rows:
            d = out.setdefault(r["day"], {"day": r["day"], "panel_wh": 0.0, "flats_wh": 0.0, "flats_solar_wh": 0.0})
            if r["meter"] == "panel":
                d["panel_wh"] += r["wh"]
            else:
                d["flats_wh"] += r["wh"]
                d["flats_solar_wh"] += r["solar_wh"]
        for d in out.values():
            d["solar_pct"] = round(100 * d["flats_solar_wh"] / d["flats_wh"]) if d["flats_wh"] else 0
            for k in ("panel_wh", "flats_wh", "flats_solar_wh"):
                d[k] = round(d[k], 3)
        return list(out.values())

    def prune(self, now: float | None = None) -> int:
        cutoff = (now or time.time()) - KEEP_SECONDS
        with self._lock:
            n = self._db.execute("DELETE FROM readings WHERE ts < ?", (cutoff,)).rowcount
            self._db.execute("DELETE FROM summaries WHERE minute < ?", (int(cutoff),))
            self._db.commit()
        return n

    def close(self) -> None:
        with self._lock:
            self._db.close()
