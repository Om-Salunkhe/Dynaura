"""Dusty panel -> USDC escrow on Arc -> paid by the sun.

Every few seconds: how much is the panel giving, as % of a clean panel in the same light?
- Under DUST_PCT (70%) for a minute: the panel is dirty. Lock CLEAN_FEE_USDC in CleaningEscrow.
- A cleaner accepts the job in the app (their own wallet).
- Back at CLEAN_PCT (90%) or more for a minute: the Pi releases the fee to the cleaner, with
  the hash of its signed meter readings as the proof. Nobody presses "approve".
- Nobody cleaned by the deadline: the Pi refunds the society.
"""
import hashlib
import json
import logging
import statistics
import threading
import time
from collections import deque

import config
from arc import ArcUnavailable
from hw import FLATS

log = logging.getLogger("dynaura.cleaning")

WINDOW = 12  # samples (one every 5 s = one minute)


class CleaningWatch:
    def __init__(self, hw, loop, store, arc, brain=None, interval: float = 5.0):
        self.hw = hw
        self.loop = loop
        self.store = store
        self.arc = arc
        self.brain = brain
        self.interval = interval
        self.samples: deque[float] = deque(maxlen=WINDOW)
        self.job: dict | None = None      # the escrow we are watching
        self.history: list[dict] = []     # finished jobs this run
        self.on_job = None                # callback(job dict) -> Arkiv
        self.error: str | None = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._last_poll = 0.0
        last = store.latest("cleaning")
        if last and (last["output"] or {}).get("status") in ("open", "accepted"):
            self.job = last["output"]  # pick the open escrow back up after a restart

    # ---- measuring -------------------------------------------------------
    def health_pct(self) -> float | None:
        pct = self.hw.panel_health_pct()
        if pct is None and config.PANEL_BEST_W > 0:
            st = self.loop.state or {}
            on_solar = [f for f in FLATS if (st.get("flats", {}).get(f) or {}).get("source") == "solar"]
            if on_solar:  # the panel meter only shows output while something draws from it
                pct = 100 * (st.get("solar_w") or 0) / config.PANEL_BEST_W
        return None if pct is None else round(min(pct, 100.0), 1)

    def level(self) -> float | None:
        return round(statistics.median(self.samples), 1) if len(self.samples) == WINDOW else None

    # ---- one step --------------------------------------------------------
    def step(self) -> dict:
        pct = self.health_pct()
        if pct is None:
            self.samples.clear()  # night, or nothing on solar: no verdict
        else:
            self.samples.append(pct)
        lvl = self.level()
        with self._lock:
            try:
                self._act(lvl)
                self.error = None
            except ArcUnavailable as e:
                self.error = str(e)
            except Exception as e:
                self.error = str(e)[:200]
                log.warning("cleaning step failed: %s", self.error)
        return self.status

    def _act(self, lvl: float | None) -> None:
        job = self.job
        if job is None:
            if lvl is not None and lvl < config.DUST_PCT and config.CLEAN_AUTO and self.arc.enabled and self.arc.escrow:
                self.open_job(config.CLEAN_FEE_USDC, config.CLEAN_DEADLINE_MIN, lvl)
            return
        now = time.time()
        if now - self._last_poll > 15 or job["status"] == "open":
            self._last_poll = now
            chain = self.arc.job(job["job_id"])
            if chain["status"] != job["status"]:
                job.update(status=chain["status"], cleaner=chain["cleaner"])
                self._save(f"Cleaning job #{job['job_id']} {chain['status']}")
        if job["status"] == "accepted" and lvl is not None and lvl >= config.CLEAN_PCT and now < job["deadline"]:
            proof = self._proof()
            tx = self.arc.release_cleaning(job["job_id"], lvl, proof)
            job.update(status="paid", output_after=lvl, release_tx=tx, proof="0x" + proof.hex())
            self._finish(f"Panel back at {lvl:.0f}%: paid {job['fee_usdc']:.2f} USDC to the cleaner")
        elif job["status"] in ("open", "accepted") and now > job["deadline"] + 5:
            tx = self.arc.refund_cleaning(job["job_id"])
            job.update(status="refunded", refund_tx=tx)
            self._finish(f"Nobody cleaned before the deadline: {job['fee_usdc']:.2f} USDC back to the society")

    def open_job(self, fee_usdc: float, deadline_min: int, lvl: float | None = None) -> dict:
        """Lock the fee in CleaningEscrow (also called by the admin from the Panel health page)."""
        if self.job:
            raise ValueError(f"cleaning job #{self.job['job_id']} is already {self.job['status']}")
        lvl = lvl if lvl is not None else (self.level() or self.health_pct() or 0)
        deadline = int(time.time() + deadline_min * 60)
        job_id, tx = self.arc.open_cleaning(fee_usdc, deadline, lvl)
        self.job = {"job_id": job_id, "status": "open", "fee_usdc": float(fee_usdc), "deadline": deadline,
                    "output_before": lvl, "output_after": None, "open_tx": tx, "cleaner": None}
        self._save(f"Panel at {lvl:.0f}% of clean: {fee_usdc:.2f} USDC locked on Arc for a cleaner")
        return self.job

    def _proof(self) -> bytes:
        """sha256 of the last 3 signed 1-minute panel summaries: anyone can re-check them on Arkiv."""
        rows = self.store.summaries(meter="panel", limit=3)
        blob = json.dumps([(r["minute"], r["avg_w"], r.get("sig")) for r in rows], sort_keys=True)
        return hashlib.sha256(blob.encode()).digest()

    def _save(self, summary: str) -> None:
        did = self.store.add_decision("cleaning", "meter", summary, dict(self.job))
        log.info(summary)
        if self.brain:
            if self.brain.uploader:
                self.brain.uploader.enqueue(did)  # episode log on 0G Storage, then Arkiv
            self.brain.notify(did)
        if self.on_job:
            try:
                self.on_job(dict(self.job))
            except Exception:
                log.exception("cleaning job callback failed")

    def _finish(self, summary: str) -> None:
        self._save(summary)
        self.history.insert(0, self.job)
        self.job = None
        self.samples.clear()

    # ---- status for the app ------------------------------------------------
    @property
    def status(self) -> dict:
        lvl = self.level()
        if self.job:
            state = self.job["status"]
        elif lvl is not None and lvl < config.DUST_PCT:
            state = "dusty"
        else:
            state = "ok"
        return {"state": state, "pct": lvl if lvl is not None else (self.samples[-1] if self.samples else None),
                "dust_pct": config.DUST_PCT, "clean_pct": config.CLEAN_PCT, "fee_usdc": config.CLEAN_FEE_USDC,
                "job": self.job, "last": self.history[0] if self.history else None,
                "arc": bool(self.arc.enabled and self.arc.escrow), "error": self.error}

    # ---- thread ------------------------------------------------------------
    def _run(self) -> None:
        while not self._stop.wait(self.interval):
            self.step()

    def start(self) -> None:
        threading.Thread(target=self._run, name="cleaning", daemon=True).start()

    def stop(self) -> None:
        self._stop.set()
