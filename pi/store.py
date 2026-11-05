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
"""


class Store:
    def __init__(self, path: str):
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            self._db.executescript(SCHEMA)
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
