"""Panel cleaning, v3 (DECISIONS Fri 22:12): look, 0G decides, the admin approves, the meter proves.

1. Look. When the meter shows the panel giving under DUST_PCT of what it should (for a minute),
   or the admin presses "Scan panel", the Pi takes a camera frame.
2. 0G decides. The frame (or, without a vision model, the meter and the weather) goes to 0G.
   Dirty: a cleaning request in state "flagged". 0G unreachable: nothing is flagged and a
   "no_check" is logged. The meter alone never flags: it can't tell dust from a cloud.
3. The admin approves. Only then does the Pi lock the fee in CleaningEscrow on Arc (openJob with
   the 0G request ID). Reject closes the request. No money moves before the approval.
4. A cleaner accepts on Arc (their own wallet), cleans, and taps "Mark done" (not a transaction).
5. The meter proves it. Over the next minute, output must reach CLEAN_PCT and be at least
   MIN_GAIN_PCT points above what it was when flagged. Then the Pi releases the fee, with the hash
   of its signed readings as the proof. Not proven by the deadline: the society is refunded.
6. Dispute. The cleaner can dispute on Arc; the committee wallet (not the Pi) resolves it.

States: flagged -> approved -> open -> accepted -> cleaned -> paid
        flagged -> rejected; open / accepted / cleaned -> refunded; accepted / cleaned -> disputed -> resolved
"""
import hashlib
import json
import logging
import statistics
import threading
import time
from collections import deque
from pathlib import Path

import config
import zg
from arc import ArcUnavailable
from hw import FLATS

log = logging.getLogger("dynaura.cleaning")

WINDOW = 12                       # samples (one every 5 s = one minute)
DISPUTE_WINDOW_S = 3 * 24 * 3600  # CleaningEscrow.DISPUTE_WINDOW
REJECT_SNOOZE_S = 3600            # after "reject", the meter waits this long before looking again
ACTIVE = ("flagged", "approved", "open", "accepted", "cleaned", "disputed")
TERMINAL = ("paid", "rejected", "refunded", "resolved")
FRAME_URL = "/api/camera/latest.jpg"


class DustCheckMissing(RuntimeError):
    """The camera or the 0G dust check is not installed on this Pi."""


class CleaningWatch:
    def __init__(self, hw, loop, store, arc, brain=None, interval: float = 5.0, capture=None, check_dust=None):
        self.hw = hw
        self.loop = loop
        self.store = store
        self.arc = arc
        self.brain = brain
        self.interval = interval
        self.capture = capture            # camera: capture(hw) -> JPEG bytes
        self.check_dust = check_dust      # 0G: check_dust(jpeg, ctx) -> verdict dict; raises when 0G is down
        self.samples: deque[float] = deque(maxlen=WINDOW)
        self.job: dict | None = None      # the cleaning request in progress
        self.history: list[dict] = []     # finished requests, newest first
        self.on_job = None                # callback(public job dict) -> Arkiv
        self.last_check: dict | None = None
        self.frame: bytes | None = None   # the last frame the Pi looked at
        self.frame_at: float | None = None
        self.error: str | None = None
        self._ask_after = 0.0             # no new automatic look before this time
        self._last_poll = 0.0
        self._lock = threading.RLock()
        self._stop = threading.Event()
        self._frame_path = Path(config.DB_PATH).resolve().parent / "camera-latest.jpg"
        if self._frame_path.exists():
            self.frame, self.frame_at = self._frame_path.read_bytes(), self._frame_path.stat().st_mtime
        self._restore()

    def _restore(self) -> None:
        """Pick the request in progress and the recent history back up after a restart."""
        seen = set()
        for d in self.store.decisions("cleaning", 100):
            j = d.get("output") or {}
            if "state" not in j or j.get("id") in seen:
                continue  # older records, or an earlier step of a request already seen
            seen.add(j.get("id"))
            if j["state"] in ACTIVE and self.job is None and not self.history:
                self.job = j
            elif j["state"] in TERMINAL:
                self.history.append(j)
        self.history = self.history[:20]

    # ---- measuring -------------------------------------------------------
    def health_pct(self) -> float | None:
        """Panel output as % of what a clean panel gives in the same light."""
        pct = self.hw.panel_health_pct()
        if pct is None and config.PANEL_BEST_W > 0:
            st = self.loop.state or {}
            on_solar = [f for f in FLATS if (st.get("flats", {}).get(f) or {}).get("source") == "solar"]
            if on_solar:  # the panel meter only shows output while something draws from it
                pct = 100 * (st.get("solar_w") or 0) / config.PANEL_BEST_W
        return None if pct is None else round(min(pct, 100.0), 1)

    def level(self) -> float | None:
        """The median over the last minute, once there is a full minute of samples."""
        return round(statistics.median(self.samples), 1) if len(self.samples) == WINDOW else None

    # ---- one step (every 5 s) ----------------------------------------------
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
            except (ArcUnavailable, zg.ZGUnavailable, DustCheckMissing) as e:
                self.error = str(e)[:200]
            except Exception as e:
                self.error = str(e)[:200]
                log.warning("cleaning step failed: %s", self.error)
        return self.status

    def _act(self, lvl: float | None) -> None:
        job = self.job
        now = time.time()
        if job is None:
            if lvl is not None and lvl >= config.DUST_PCT:
                self._ask_after = min(self._ask_after, now)  # clean again: the next drop gets a fresh look
            elif lvl is not None and config.CLEAN_AUTO and now >= self._ask_after and self._can_look():
                self._ask_after = now + config.DUST_RECHECK_S
                self._look("meter", lvl)  # the meter drop only triggers a look
            return

        state = job["state"]
        if state in ("flagged", "approved"):
            self._refresh_root(job)  # waits for the admin
            return
        if now - self._last_poll > 15 or state == "open":
            self._last_poll = now
            self._sync_chain(job)
            if self.job is None:
                return
            self._link_episode(job)
            state = job["state"]

        if job.get("done_at") and state in ("cleaned", "disputed") and lvl is not None:
            job["after_pct"] = lvl  # the median since "Mark done" (the window was cleared then)
            if now <= job["deadline"] and self.proven(job):
                self._release(job, lvl)
                return
        if state in ("open", "accepted", "cleaned") and now > job["deadline"] + 5:
            self._refund(job, "Nobody proved a clean panel before the deadline")
        elif state == "disputed" and now > job["deadline"] + DISPUTE_WINDOW_S + 5:
            self._refund(job, "The committee did not resolve the dispute in time")

    @staticmethod
    def proven(job: dict) -> bool:
        """Pawan's rule: clean enough AND clearly better than when it was flagged."""
        after, before = job.get("after_pct"), job.get("dusty_pct") or 0.0
        return after is not None and after >= config.CLEAN_PCT and after >= before + config.MIN_GAIN_PCT

    # ---- 1-2. look and let 0G decide ----------------------------------------
    def _can_look(self) -> bool:
        return self.capture is not None and self.check_dust is not None

    def scan(self, source: str = "admin") -> dict:
        """Admin "Scan panel" (or the meter): a frame goes to 0G now. Returns {job} or {dirty: False, og}.
        Raises zg.ZGUnavailable when 0G can't be reached (nothing is flagged)."""
        with self._lock:
            if self.job:
                return {"job": self.public(self.job)}
            return self._look(source, self.level() or self.health_pct())

    def _look(self, source: str, lvl: float | None) -> dict:
        if not self._can_look():
            raise DustCheckMissing("the camera or the 0G dust check is not installed on this Pi")
        jpeg = self._capture()
        self.frame, self.frame_at = jpeg, time.time()
        try:
            self._frame_path.write_bytes(jpeg)
        except OSError as e:
            log.warning("could not keep the camera frame: %s", e)
        ctx = self._ctx(lvl, source)
        try:
            verdict = self.check_dust(jpeg, ctx)
        except Exception as e:
            self._no_check(source, lvl, e)
            if isinstance(e, zg.ZGUnavailable):
                raise
            raise zg.ZGUnavailable(f"0G dust check failed: {e}") from e

        og = self._record_verdict(verdict, source, lvl)
        self.last_check = {"at": time.time(), "source": source, "result": "dirty" if og["dirty"] else "clean",
                           "health_pct": lvl, "og": og}
        if not og["dirty"]:
            log.info("panel at %s%%, 0G says it is not dirty (%s)", lvl, og["reason"])
            return {"dirty": False, "og": og}
        now = time.time()
        self.job = {
            "id": og["decision_id"], "state": "flagged", "source": source,
            "fee_usdc": config.CLEAN_FEE_USDC, "deadline": None, "created_at": now, "updated_at": now,
            "dusty_pct": lvl, "after_pct": None, "done_at": None, "cleaner": None, "resolution": None,
            "og": og, "arc": {"job_id": None, "open_tx": None, "release_tx": None, "refund_tx": None,
                              "proof_hash": None, "link_tx": None},
            "arkiv_key": None,
        }
        cov = og.get("coverage_pct")
        self._save(f"0G: the panel is dirty ({cov if cov is not None else '?'}% covered, output {lvl}%): "
                   "waiting for the admin to approve a cleaning")
        return {"job": self.public(self.job)}

    def _capture(self) -> bytes:
        try:
            return self.capture(self.hw)
        except TypeError:
            return self.capture()  # a camera that doesn't need the hardware object

    def _ctx(self, lvl: float | None, source: str) -> dict:
        st = self.loop.state or {}
        panel_w = st.get("solar_w")
        expected_w = round(panel_w * 100 / lvl, 2) if panel_w and lvl else None
        cloud = None
        try:  # the hour's cloud cover (cached forecast); a meter alone can't tell dust from a cloud
            from forecast import forecast_day
            hour = time.localtime().tm_hour
            cloud = next((h["cloud"] for h in forecast_day("today").get("hours", []) if h["hour"] == hour), None)
        except Exception:
            pass
        return {"health_pct": lvl, "dusty_threshold_pct": config.DUST_PCT, "panel_w": panel_w,
                "expected_w": expected_w, "cloud_pct": cloud, "hw": config.HW, "source": source}

    def _record_verdict(self, v: dict, source: str, lvl: float | None) -> dict:
        tee = v.get("tee")
        tee_ok = tee.get("tee_verified") if isinstance(tee, dict) else tee
        did = v.get("decision_id")
        if not did:  # the dust check didn't record itself: record it like every other 0G decision
            summary = (f"0G dust check ({v.get('input') or 'vision'}): "
                       f"{'dirty' if v.get('dirty') else 'clean'}, {v.get('reason') or ''}")[:240]
            did = self.store.add_decision(
                "dust", "ai", summary,
                {k: v.get(k) for k in ("dirty", "coverage_pct", "reason", "input")} | {"source": source, "health_pct": lvl},
                request_id=v.get("request_id"), model=v.get("model"),
                tee=tee if isinstance(tee, dict) else {"tee_verified": tee})
            self._publish(did)
        return {"request_id": v.get("request_id"), "tee": tee_ok, "decision_id": did, "dirty": bool(v.get("dirty")),
                "coverage_pct": v.get("coverage_pct"), "reason": v.get("reason"),
                "input": v.get("input") or "vision", "storage_root": None, "frame_url": FRAME_URL}

    def _no_check(self, source: str, lvl: float | None, err: Exception) -> None:
        """0G was unreachable: log it honestly. Nothing is flagged and no verdict is invented."""
        msg = str(err)[:200]
        did = self.store.add_decision("dust", "no_check", f"0G unreachable, panel not checked ({source}): {msg}",
                                      {"error": msg, "source": source, "health_pct": lvl})
        self._publish(did)
        self.last_check = {"at": time.time(), "source": source, "result": "no_check", "health_pct": lvl,
                           "error": msg, "decision_id": did}
        log.warning("0G dust check unavailable (%s): nothing flagged", msg)
        if self.on_job:
            self._emit({"id": did, "state": "no_check", "fee_usdc": 0, "deadline": None, "created_at": time.time(),
                        "dusty_pct": lvl, "after_pct": None, "og": {}, "arc": {}})

    # ---- 3. the admin decides ----------------------------------------------
    def approve(self, fee_usdc: float | None = None) -> dict:
        """Admin approves the flagged request: lock the fee in CleaningEscrow with the 0G request ID."""
        with self._lock:
            job = self._need("flagged")
            if not (self.arc.enabled and self.arc.escrow):
                raise ArcUnavailable("Arc is not set up: add ARC_PRIVATE_KEY and ARC_ESCROW to .env")
            fee = float(fee_usdc if fee_usdc is not None else config.CLEAN_FEE_USDC)
            if not 0 < fee <= 100:
                raise ValueError("fee_usdc must be between 0 and 100")
            deadline = int(time.time() + config.CLEAN_DEADLINE_MIN * 60)
            job.update(fee_usdc=fee, deadline=deadline)
            self._set(job, "approved", f"Admin approved the cleaning: locking {fee:.2f} USDC on Arc")
            try:
                arc_id, tx = self.arc.open_cleaning(fee, deadline, job.get("dusty_pct") or 0,
                                                    job["og"].get("request_id") or "")
            except Exception:
                job.update(deadline=None)
                self._set(job, "flagged", "Locking the fee on Arc failed: still waiting for approval")
                raise
            job["arc"].update(job_id=arc_id, open_tx=tx)
            self._set(job, "open", f"{fee:.2f} USDC locked in Arc escrow #{arc_id}: waiting for a cleaner")
            self._link_episode(job)
            return {"job": self.public(job)}

    def reject(self) -> dict:
        with self._lock:
            job = self._need("flagged")
            self._ask_after = time.time() + REJECT_SNOOZE_S
            self._finish(job, "rejected", "Admin dismissed the cleaning request: no money moved")
            return {"job": self.public(job)}

    # ---- 4. the cleaner -------------------------------------------------------
    def mark_done(self) -> dict:
        """The cleaner says the panel is clean. Nothing is paid yet: the meter measures for a minute."""
        with self._lock:
            job = self.job
            if job and job["state"] == "open":
                self._sync_chain(job)  # they may have accepted a moment ago
                job = self.job
            if job and job["state"] == "cleaned":
                return {"job": self.public(job)}
            job = self._need("accepted")
            job.update(done_at=time.time(), after_pct=None)
            self.samples.clear()  # after_pct comes only from readings taken after "Mark done"
            self._set(job, "cleaned", "Cleaner marked the panel clean: the meter is checking it")
            return {"job": self.public(job)}

    # ---- 5. money moves only from what the meter measured ---------------------
    def _release(self, job: dict, after: float) -> None:
        proof = self._proof()
        tx = self.arc.release_cleaning(job["arc"]["job_id"], after, proof)
        job["arc"].update(release_tx=tx, proof_hash="0x" + proof.hex())
        job["after_pct"] = after
        self._finish(job, "paid", f"Panel back at {after:.0f}% (was {job.get('dusty_pct') or 0:.0f}%): "
                                  f"paid {job['fee_usdc']:.2f} USDC to the cleaner")

    def _refund(self, job: dict, why: str) -> None:
        tx = self.arc.refund_cleaning(job["arc"]["job_id"])
        job["arc"]["refund_tx"] = tx
        self._finish(job, "refunded", f"{why}: {job['fee_usdc']:.2f} USDC back to the society")

    def _sync_chain(self, job: dict) -> None:
        """Follow what happened on Arc: accepted, disputed, or settled by the committee."""
        chain = self.arc.job(job["arc"]["job_id"])
        cs, state = chain["status"], job["state"]
        if chain.get("cleaner") and int(chain["cleaner"], 16):
            job["cleaner"] = chain["cleaner"]
        if cs == "accepted" and state == "open":
            self._set(job, "accepted", f"A cleaner accepted escrow #{job['arc']['job_id']}")
        elif cs == "disputed" and state != "disputed":
            self._set(job, "disputed", "The cleaner disputed the job: the committee decides")
        elif cs == "paid":  # only resolve() pays without the Pi
            job["resolution"] = "paid_cleaner"
            self._finish(job, "resolved", "The committee resolved the dispute: the cleaner is paid")
        elif cs in ("refunded", "cancelled"):
            if state == "disputed" and time.time() <= job["deadline"] + DISPUTE_WINDOW_S:
                job["resolution"] = "refunded"
                self._finish(job, "resolved", "The committee resolved the dispute: the society is refunded")
            else:
                self._finish(job, "refunded", f"Escrow #{job['arc']['job_id']} was {cs} on Arc")

    def _proof(self) -> bytes:
        """sha256 of the last 3 signed 1-minute panel summaries: anyone can re-check them on Arkiv."""
        rows = self.store.summaries(meter="panel", limit=3)
        blob = json.dumps([(r["minute"], r["avg_w"], r.get("sig")) for r in rows], sort_keys=True)
        return hashlib.sha256(blob.encode()).digest()

    # ---- 0G Storage root of the dust check -------------------------------------
    def _refresh_root(self, job: dict) -> str | None:
        """The episode reaches 0G Storage after the check: pick its root up when it lands."""
        og = job["og"]
        if not og.get("storage_root") and og.get("decision_id"):
            root = (self.store.decision(og["decision_id"]) or {}).get("storage_root")
            if root:
                og["storage_root"] = root
                self._emit(job)
        return og.get("storage_root")

    def _link_episode(self, job: dict) -> None:
        """Write the dust check's 0G Storage root into the escrow, once."""
        if job["arc"].get("link_tx") or not job["arc"].get("job_id") or job.get("link_tries", 0) >= 3:
            return
        root = self._refresh_root(job)
        if not root:
            return
        try:
            job["arc"]["link_tx"] = self.arc.link_episode(job["arc"]["job_id"], root)
            log.info("Escrow #%s linked to 0G episode %s", job["arc"]["job_id"], root)
        except Exception as e:
            job["link_tries"] = job.get("link_tries", 0) + 1
            log.warning("linkEpisode failed: %s", str(e)[:200])

    # ---- bookkeeping ------------------------------------------------------------
    def _need(self, state: str) -> dict:
        if not self.job:
            raise ValueError("there is no cleaning request")
        if self.job["state"] != state:
            raise ValueError(f"the cleaning request is {self.job['state']}, not {state}")
        return self.job

    def _set(self, job: dict, state: str, summary: str) -> None:
        job["state"] = state
        self._save(summary)

    def _finish(self, job: dict, state: str, summary: str) -> None:
        job["state"] = state
        self._save(summary)
        self.history.insert(0, job)
        del self.history[20:]
        self.job = None
        self.samples.clear()

    def _save(self, summary: str, job: dict | None = None) -> int:
        job = job or self.job
        job["updated_at"] = time.time()
        did = self.store.add_decision("cleaning", "meter", summary, dict(job))
        log.info(summary)
        self._publish(did)
        self._emit(job)
        return did

    def _publish(self, did: int) -> None:
        if self.brain:
            if self.brain.uploader:
                self.brain.uploader.enqueue(did)  # episode log on 0G Storage, then Arkiv
            self.brain.notify(did)

    def _emit(self, job: dict) -> None:
        if self.on_job:
            try:
                self.on_job(self.public(job))
            except Exception:
                log.exception("cleaning job callback failed")

    # ---- what the app sees ---------------------------------------------------------
    @staticmethod
    def public(job: dict | None) -> dict | None:
        if job is None:
            return None
        out = {k: v for k, v in job.items() if k != "link_tries"}
        out["status"] = job["state"]                     # older screens read "status"
        out["job_id"] = (job.get("arc") or {}).get("job_id")  # ... and the Arc escrow id as job_id
        return out

    @property
    def status(self) -> dict:
        lvl = self.level()
        if self.job:
            state = self.job["state"]
        elif lvl is not None and lvl < config.DUST_PCT:
            state = "dusty"
        else:
            state = "ok"
        return {"job": self.public(self.job), "history": [self.public(h) for h in self.history[:10]],
                "state": state, "pct": lvl if lvl is not None else (self.samples[-1] if self.samples else None),
                "dust_pct": config.DUST_PCT, "clean_pct": config.CLEAN_PCT, "min_gain_pct": config.MIN_GAIN_PCT,
                "fee_usdc": config.CLEAN_FEE_USDC, "deadline_min": config.CLEAN_DEADLINE_MIN,
                "last": self.public(self.history[0]) if self.history else None, "last_check": self.last_check,
                "frame_at": self.frame_at, "dust_check": self._can_look(),
                "arc": bool(self.arc.enabled and self.arc.escrow), "error": self.error}

    # ---- thread ----------------------------------------------------------------------
    def _run(self) -> None:
        while not self._stop.wait(self.interval):
            self.step()

    def start(self) -> None:
        threading.Thread(target=self._run, name="cleaning", daemon=True).start()

    def stop(self) -> None:
        self._stop.set()
