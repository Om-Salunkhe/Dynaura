// The hero moment as one state every screen reads:
//   clean -> dusty -> open (escrow on Arc) -> accepted -> cleaning (meter climbing) -> paid
// Live from the Pi's /api/stream `cleaning` block when it is there, otherwise the demo scene.
import { useEffect, useState } from "react";
import { getJSON, postJSON } from "./api.js";
import { demoHero, heroActions, useClock, useScene } from "./scene.js";

export const STAGES = ["clean", "dusty", "open", "accepted", "cleaning", "paid"];
export const stageIndex = (s) => (s === "refunded" ? STAGES.length : STAGES.indexOf(s));

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

/**
 * The hero flow for any screen. Pass the page's `useLive()` result.
 * `hero.og` holds the 0G Storage roots of the episode logs (open / paid) when the Pi has them.
 */
export function useHero(live) {
  const scene = useScene();
  const c = !live.demo ? live.cleaning : null;
  const [done, setDone] = useState(doneJobs);
  const demo = !c;
  // tick while the demo timeline is moving
  const moving = demo && scene.dustAt && !(scene.doneAt && Date.now() - scene.doneAt > 8000);
  const now = useClock(150, !!moving);
  const h = c ? fromLive(c, live, done) : demoHero(scene, now);
  const roots = useCleaningRoots(!!c, `${h.job?.id}:${h.stage}`);

  if (c && h.job) {
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

