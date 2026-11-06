// The hero moment as one state every screen reads (cleaning flow v3):
//   clean -> dusty -> flagged (0G says dirty, waiting for the committee) -> open (escrow on Arc)
//   -> accepted -> cleaning (marked done, meter checking) -> paid; or refunded / disputed -> resolved
// Live from the Pi's /api/cleaning (v3) or its older /api/stream block, otherwise the demo scene.
import { useEffect, useState } from "react";
import { getJSON, postJSON, useLive } from "./api.js";
import { cleaningApi, useCleaningApi } from "./cleaningApi.js";
import { demoHero, heroActions, useClock, useScene } from "./scene.js";

export const STAGES = ["clean", "dusty", "open", "accepted", "cleaning", "paid"];
// flagged sits on the "dusty" step (escrow not open yet); a dispute waits where the meter would
const EXTRA = { flagged: 1, disputed: 4, resolved: 5, refunded: STAGES.length };
export const stageIndex = (s) => EXTRA[s] ?? STAGES.indexOf(s);

// Pi v3 job state -> hero stage
const V3_STAGE = {
  flagged: "flagged",
  approved: "open",
  open: "open",
  accepted: "accepted",
  cleaned: "cleaning",
  paid: "paid",
  refunded: "refunded",
  disputed: "disputed",
  resolved: "resolved",
  rejected: "clean",
  no_check: "clean",
};

const verdictOf = (og) =>
  og && {
    dirty: og.dirty,
    coverage: og.coverage_pct,
    reason: og.reason,
    requestId: og.request_id,
    tee: og.tee,
    input: og.input,
    decisionId: og.decision_id,
    storageRoot: og.storage_root,
    frameUrl: og.frame_url,
  };

function fromV3(api, live) {
  // the Pi's /api/cleaning status (pct, lines, last scan…), the stream as a fallback
  const sse = { ...(live.cleaning || {}), ...(api.data || {}) };
  const cur = api.job || null;
  const last = (api.history || []).find((h) => ["paid", "refunded", "resolved"].includes(h.state));
  let j = cur;
  let stage;
  if (cur) stage = V3_STAGE[cur.state] || "clean";
  else if (last && Date.now() / 1000 - (last.updated_at || 0) < 6 * 3600) {
    j = last; // the latest finished job stays on screen for a while
    stage = V3_STAGE[last.state];
  } else stage = sse.state === "dusty" || (sse.pct != null && sse.dust_pct != null && sse.pct < sse.dust_pct) ? "dusty" : "clean";
  return {
    live: true,
    v3: true,
    state: j?.state ?? null,
    stage,
    pct: sse.pct ?? j?.after_pct ?? j?.dusty_pct ?? null,
    dustPct: sse.dust_pct ?? 70,
    cleanPct: sse.clean_pct ?? 90,
    minGain: sse.min_gain_pct ?? 15,
    lastCheck: sse.last_check || null, // {at, source, result: dirty|clean|no_check, health_pct, og|error}
    dustCheck: sse.dust_check, // false until the Pi has its camera + 0G dust check
    fee: j?.fee_usdc ?? sse.fee_usdc ?? 2,
    flagged: !["clean", "dusty"].includes(stage),
    arc: sse.arc ?? true,
    error: sse.error || api.error,
    actualW: live.meters?.panel?.w ?? live.solar_w ?? null,
    verdict: verdictOf(j?.og),
    dustyPct: j?.dusty_pct ?? null,
    afterPct: j?.after_pct ?? null,
    updatedAt: j?.updated_at,
    job: j && {
      id: j.arc?.job_id ?? null, // the Arc escrow id (null until the committee approves)
      piId: j.id,
      fee: j.fee_usdc,
      outputBefore: j.dusty_pct,
      outputAfter: j.after_pct,
      deadline: j.deadline ? j.deadline * 1000 : null,
      cleaner: j.cleaner || j.arc?.cleaner,
      resolution: j.resolution === "paid_cleaner" ? "paid" : j.resolution || null,
      openTx: j.arc?.open_tx,
      releaseTx: j.arc?.release_tx,
      refundTx: j.arc?.refund_tx,
      proof: j.arc?.proof_hash,
      requestId: j.og?.request_id,
      proofWindow: j.arc?.proof_window, // [from, to] minutes the proof hashed, if the Pi says
      proofMinutes: j.arc?.proof_minutes,
      releasedAt: j.state === "paid" ? j.updated_at : null,
    },
    og: j && { open: j.og?.storage_root, paid: ["paid", "resolved"].includes(j.state) ? j.og?.storage_root : null },
  };
}

// What the cleaner tapped "Mark done" on, per job, so a reload keeps it
const DONE_KEY = "dynaura.cleaner.done";
const doneJobs = () => {
  try {
    return JSON.parse(localStorage.getItem(DONE_KEY)) || {};
  } catch {
    return {};
  }
};

/** 0G Storage roots of the Pi's cleaning episode logs, by job id and status. */
function useCleaningRoots(on, key) {
  const [roots, setRoots] = useState({});
  useEffect(() => {
    if (!on) return undefined;
    let alive = true;
    const load = () =>
      getJSON("/api/decisions?kind=cleaning&limit=10")
        .then((rows) => {
          if (!alive) return;
          const out = {};
          for (const r of rows) {
            const id = r.output?.job_id;
            if (id != null && r.storage_root) out[`${id}:${r.output.status}`] ??= r.storage_root;
            if (id != null && r.episode_tx) out[`${id}:${r.output.status}:tx`] ??= r.episode_tx; // EpisodeRegistry record
          }
          setRoots(out);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 10000); // uploads finish in the background
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [on, key]);
  return roots;
}

function fromLive(c, live, done) {
  const job = c.job || null;
  const last = c.last || null;
  let stage = "clean";
  let j = job;
  if (job) {
    stage = job.status; // open | accepted
    if (job.status === "accepted" && (done[job.job_id] || (c.pct != null && c.pct >= c.clean_pct))) stage = "cleaning";
  } else if (c.state === "dusty" || (c.pct != null && c.pct < c.dust_pct)) {
    stage = "dusty"; // under the line; the Pi confirms for a minute before it says "dusty"
  } else if (last) {
    stage = last.status === "paid" ? "paid" : "refunded";
    j = last;
  }
  return {
    live: true,
    stage,
    pct: c.pct,
    dustPct: c.dust_pct,
    cleanPct: c.clean_pct,
    fee: j?.fee_usdc ?? c.fee_usdc,
    flagged: stage !== "clean" && !(stage === "dusty" && c.state !== "dusty"),
    arc: c.arc,
    error: c.error,
    actualW: live.meters?.panel?.w ?? live.solar_w ?? null,
    job: j && {
      id: j.job_id,
      fee: j.fee_usdc,
      outputBefore: j.output_before,
      outputAfter: j.output_after,
      deadline: j.deadline * 1000,
      cleaner: j.cleaner,
      openTx: j.open_tx,
      releaseTx: j.release_tx,
      refundTx: j.refund_tx,
      proof: j.proof, // sha256 of the signed meter minutes the release was based on
    },
  };
}

/** Is a cleaning request waiting for the committee? (for the admin nav dot; no clock) */
export function useCleaningAlert() {
  const live = useLive();
  const api = useCleaningApi(!live.demo);
  const scene = useScene();
  if (!live.demo) return api.supported === true && api.job?.state === "flagged";
  return demoHero(scene).stage === "flagged";
}

/**
 * The hero flow for any screen. Pass the page's `useLive()` result.
 * `hero.og` holds the 0G Storage roots of the episode logs (open / paid) when the Pi has them.
 */
export function useHero(live) {
  const scene = useScene();
  const api = useCleaningApi(!live.demo);
  const v3 = !live.demo && api.supported === true;
  const c = !live.demo ? live.cleaning : null;
  const [done, setDone] = useState(doneJobs);
  const demo = !c && !v3;
  // tick while the demo timeline is moving
  const moving = demo && scene.dustAt && !(scene.doneAt && Date.now() - scene.doneAt > 8000);
  const now = useClock(150, !!moving);
  const h = v3 ? fromV3(api, live) : c ? fromLive(c, live, done) : demoHero(scene, now);
  const roots = useCleaningRoots(!!c && !v3, `${h.job?.id}:${h.stage}`);

  if (c && !v3 && h.job) {
    const id = h.job.id;
    h.og = { open: roots[`${id}:open`], paid: roots[`${id}:paid`], openTx: roots[`${id}:open:tx`], paidTx: roots[`${id}:paid:tx`] };
  }
  if (demo && h.job) h.og = { open: "0xdemo-root-open", paid: h.stage === "paid" ? "0xdemo-root-paid" : null };
  if (h.pct != null && h.actualW == null) h.actualW = +(2.1 * (h.pct / 100)).toFixed(2);
  // The panel meter only reads while a flat draws from it: no load, no watts to compare
  if (h.live && (h.actualW ?? 0) < 0.01) h.actualW = null;
  h.expectedW = h.pct && h.actualW != null ? +(h.actualW / (h.pct / 100)).toFixed(2) : null;
  h.idle = h.live && h.actualW == null;

  h.actions = demo
    ? heroActions
    : v3
      ? {
          accept: null, // a wallet transaction (CleanerJobs)
          // "Mark done" is not a chain tx and moves no money: it asks the Pi to start the
          // confirm window. The Pi pays only if the meter proves the panel is clean again.
          done: () => cleaningApi.done(),
          scan: () => cleaningApi.scan(),
          approve: (fee) => cleaningApi.approve(fee),
          reject: () => cleaningApi.reject(),
          dust: () => postJSON("/api/moment/dust", {}, { admin: true }),
          reset: () => postJSON("/api/moment/clean", {}, { admin: true }),
        }
      : {
        accept: null, // live accept is a wallet transaction (CleanerJobs)
        // "Mark done" is not a chain tx and pays nothing: it only switches this screen to the live
        // meter. The Pi samples the panel every 5 s and releases the escrow itself once output
        // holds the clean line for a minute (meter proof, not the cleaner's word).
        done: () => {
          if (!h.job) return;
          const next = { ...doneJobs(), [h.job.id]: Date.now() };
          localStorage.setItem(DONE_KEY, JSON.stringify(next));
          setDone(next);
        },
        dust: () => postJSON("/api/moment/dust", {}, { admin: true }),
        reset: () => postJSON("/api/moment/clean", {}, { admin: true }),
      };
  return h;
}

