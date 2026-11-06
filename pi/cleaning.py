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
DISPUTE_WINDOW_S = 3 * 24 * 3600  # CleaningEscrow.DISPUTE_WINDOW


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
        # ---- HOOK (Om): 0G confirms the dust before any money moves -------------------------
        # Set to a function(level_pct) -> (panel_dirty: bool, decision_id: int) that makes ONE
        # 0G call (zg.chat), records it as a decision (kind "dust", mode "ai") and returns.
        # It must raise (e.g. zg.ZGUnavailable) when 0G gives no usable answer: then no escrow
        # opens, and the function itself should have logged a "no-ai" decision.
        # None = today's behaviour: the meter alone opens the escrow.
        self.confirm_dirty = None
        self._ask_after = 0.0             # no new 0G dust check before this time
        self.error: str | None = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._last_poll = 0.0
        last = store.latest("cleaning")
        if last and (last["output"] or {}).get("status") in ("open", "accepted", "disputed"):
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
            if lvl is not None and lvl >= config.DUST_PCT:
                self._ask_after = 0.0  # clean again: the next dust gets a fresh 0G check
            if lvl is not None and lvl < config.DUST_PCT and config.CLEAN_AUTO and self.arc.enabled and self.arc.escrow:
                og_decision = None
                if self.confirm_dirty is not None:
                    if time.time() < self._ask_after:
                        return
                    self._ask_after = time.time() + config.DUST_RECHECK_S
                    try:
                        dirty, og_decision = self.confirm_dirty(lvl)
                    except Exception as e:
                        raise RuntimeError(f"0G could not confirm the dust, no money moved: {e}") from e
                    if not dirty:
                        log.info("panel at %.0f%%, but 0G says it is not dirty (decision #%s)", lvl, og_decision)
                        return
                self.open_job(config.CLEAN_FEE_USDC, config.CLEAN_DEADLINE_MIN, lvl, og_decision=og_decision)
            return
        now = time.time()
        if now - self._last_poll > 15 or job["status"] == "open":
            self._last_poll = now
            chain = self.arc.job(job["job_id"])
            if chain["status"] != job["status"]:
                job.update(status=chain["status"], cleaner=chain["cleaner"])
                if chain["status"] in ("paid", "refunded", "cancelled"):  # settled by the committee or the payer
                    job.update(output_after=chain["output_after"], settled_by="committee or payer")
                    self._finish(f"Cleaning job #{job['job_id']} {chain['status']}")
                    return
                self._save(f"Cleaning job #{job['job_id']} {chain['status']}")
            self._link_episode(job)
        if job["status"] in ("accepted", "disputed") and lvl is not None and lvl >= config.CLEAN_PCT and now < job["deadline"]:
            proof = self._proof()
            tx = self.arc.release_cleaning(job["job_id"], lvl, proof)
            job.update(status="paid", output_after=lvl, release_tx=tx, proof="0x" + proof.hex())
            self._finish(f"Panel back at {lvl:.0f}%: paid {job['fee_usdc']:.2f} USDC to the cleaner")
        elif (job["status"] in ("open", "accepted") and now > job["deadline"] + 5) or \
                (job["status"] == "disputed" and now > job["deadline"] + DISPUTE_WINDOW_S + 5):
            tx = self.arc.refund_cleaning(job["job_id"])
            job.update(status="refunded", refund_tx=tx)
            self._finish(f"Nobody cleaned before the deadline: {job['fee_usdc']:.2f} USDC back to the society")

    def open_job(self, fee_usdc: float, deadline_min: int, lvl: float | None = None,
                 og_decision: int | None = None, og_request_id: str = "") -> dict:
        """Lock the fee in CleaningEscrow (also called by the admin from the Panel health page).
        og_decision: id of the 0G dust-check decision behind the job (from the confirm_dirty hook).
        og_request_id: the 0G request ID kept on chain; taken from og_decision when not given."""
        if self.job:
            raise ValueError(f"cleaning job #{self.job['job_id']} is already {self.job['status']}")
        lvl = lvl if lvl is not None else (self.level() or self.health_pct() or 0)
        deadline = int(time.time() + deadline_min * 60)
        og = self.store.decision(og_decision) if og_decision else None  # the 0G dust check behind it
        og_request_id = og_request_id or (og or {}).get("request_id") or ""
        job_id, tx = self.arc.open_cleaning(fee_usdc, deadline, lvl, og_request_id)
        self.job = {"job_id": job_id, "status": "open", "fee_usdc": float(fee_usdc), "deadline": deadline,
                    "output_before": lvl, "output_after": None, "open_tx": tx, "cleaner": None,
                    "og_decision_id": og_decision, "og_request_id": og_request_id or None,
                    "og_storage_root": (og or {}).get("storage_root")}
        self.job["decision_id"] = self._save(f"Panel at {lvl:.0f}% of clean: {fee_usdc:.2f} USDC locked on Arc for a cleaner")
        return self.job

    def _link_episode(self, job: dict) -> None:
        """Once the episode behind the job is on 0G Storage, write its root into the escrow (once).
        Prefer the 0G dust-check decision that opened it; else the job's own cleaning decision."""
        if job.get("link_tx") or job.get("link_tries", 0) >= 3:
            return
        root = job.get("og_storage_root")
        if not root:
            did = job.get("og_decision_id") or job.get("decision_id")
            d = self.store.decision(did) if did else None
            root = d and d.get("storage_root")
        if not root:
            return
        try:
            job["link_tx"] = self.arc.link_episode(job["job_id"], root)
            job["og_storage_root"] = root
            log.info("Cleaning job #%s linked to 0G episode %s", job["job_id"], root)
        except Exception as e:
            job["link_tries"] = job.get("link_tries", 0) + 1
            log.warning("linkEpisode failed: %s", str(e)[:200])

    def _proof(self) -> bytes:
        """sha256 of the last 3 signed 1-minute panel summaries: anyone can re-check them on Arkiv."""
        rows = self.store.summaries(meter="panel", limit=3)
        blob = json.dumps([(r["minute"], r["avg_w"], r.get("sig")) for r in rows], sort_keys=True)
        return hashlib.sha256(blob.encode()).digest()

    def _save(self, summary: str) -> int:
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
        return did

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
