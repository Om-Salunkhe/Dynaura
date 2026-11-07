// Reads Dynaura's records straight from Arkiv in the browser: no server in between,
// so anyone can check what the app shows. Only entities the building wallet created and still
// owns count (see arkivReads.js for the queries themselves).
import { useEffect, useState } from "react";
import { verifyPayout } from "./arkivProof.js";
import * as reads from "./arkivReads.js";

// The building wallet that writes the live records (public); VITE_ARKIV_OWNER overrides it
export const OWNER = import.meta.env.VITE_ARKIV_OWNER || "0xd961a5C42dd84F003Ef3C85a1bD08BE59A8717Cd";
export const BUILDING = import.meta.env.VITE_BUILDING_ID || "sunrise-apartments";
export const ARKIV_READY = /^0x[0-9a-fA-F]{40}$/.test(OWNER);
export const EXPLORER = "https://rabdi.explorer.arkiv.network";

// Reads use a SEPARATE, public, read-only access key made just for this app
// (VITE_ARKIV_PUBLIC_READ_KEY), never the bridge's key. rabdi() puts the key in the RPC URL, so
// whatever is set here is public: create it for the web app alone, restrict it to the app's origin
// if the Arkiv hub allows, and revoke it after the event. Without it the app reads the keyless
// public endpoint, which is fine when quiet but was rate limited at the venue (4/60 queries got
// through on 6 Nov evening, 60/60 with a key): see arkiv/how-you-use-arkiv.md.
const PUBLIC_READ_KEY = import.meta.env.VITE_ARKIV_PUBLIC_READ_KEY || "";
let ctx;
function arkiv() {
  if (!ctx) ctx = { client: reads.arkivClient(PUBLIC_READ_KEY), owner: OWNER, building: BUILDING };
  return ctx;
}

export const fetchDecisions = (limit = 20) => reads.decisions(arkiv(), limit);
export const fetchMaintenance = (limit = 20) => reads.maintenance(arkiv(), limit);
/** The building's heartbeat entity: if it expired (Pi off > 2 min), there is none. */
export const fetchHeartbeat = () => reads.heartbeat(arkiv());
/** The 0G decision behind a request ID (e.g. a cleaning job's og_request_id), or null. */
export const fetchDecisionByOgRequest = (ogRequestId) => reads.decisionByOgRequest(arkiv(), ogRequestId);
/** Live offers of spare solar. Expired ones (solar window closed) are simply not returned. */
export const fetchOffers = (limit = 20) => reads.offers(arkiv(), limit);
/** Cleaning requests (v3): fetchCleaningJobs({ status: "flagged" }) or ({ statuses: ["open", "accepted", "cleaned"] }) */
export const fetchCleaningJobs = (opts) => reads.cleaningJobs(arkiv(), opts);
/** A cleaner's work history, owned by the cleaner's wallet: fetchWorkReceipts({ cleaner: "0x..." }) */
export const fetchWorkReceipts = (opts) => reads.workReceipts(arkiv(), opts);
/** Fair-share credit periods on Arkiv, newest day first: fetchCreditPeriods({ limit: 7 }) */
export const fetchCreditPeriods = (opts) => reads.creditPeriods(arkiv(), opts);
/** 0G trade decisions on Arkiv (where the spare sun went): fetchTrades({ mode: "ai" }) */
export const fetchTrades = (opts) => reads.trades(arkiv(), opts);
/** Resident bills: fetchBills({ flat: "A" }) or fetchBills({ month: "2026-11" }) */
export const fetchBills = (opts) => reads.bills(arkiv(), opts);
/** Shop sales settled on Arc: fetchSales({ buyer: "0x..." }) */
export const fetchSales = (opts) => reads.sales(arkiv(), opts);
/** Daily totals (the same rows Dyna's planner reads), newest first. */
export const fetchDailyOutput = (days = 7) => reads.dailyOutput(arkiv(), days);
/** Signed 1-minute readings: fetchReadings({ meter: "panel", since: unixSeconds }) */
export const fetchReadings = (opts) => reads.readings(arkiv(), opts);

/** "Verify payout": re-fetches a paid job's signed panel readings from Arkiv (job.proofWindow),
 *  checks every signature against the Pi's device key and recomputes the escrow's proof hash.
 *  verifyJobPayout(job, { expectedHash: <proofHash read from Arc> }) compares with Arc; without it,
 *  with job.proofHash from Arkiv. Returns { ok, signaturesOk, hashOk, computed, expected, signer,
 *  window, readings }. */
export const verifyJobPayout = (job, opts) => verifyPayout(arkiv(), job, opts);

export const ARKIV_BUSY_TEXT = "Arkiv busy, retrying";

/**
 * Run an Arkiv read; fall back to demo data when Arkiv isn't configured or reachable.
 * State: { data, live, error, limited, retryAt }.
 * - limited: Arkiv's free public endpoint is out of queries (429 ANON_COST_LIMITED). The read is
 *   retried by itself when the pause ends (retryAt, ms). Screens should say ARKIV_BUSY_TEXT, not
 *   "not reachable", and not pass the demo data off as live.
 * - If the read worked before, its last real data stays on screen while Arkiv is busy (live: false).
 */
export function useArkiv(fn, fallback, deps = []) {
  const [state, setState] = useState({ data: fallback, live: false, error: null, limited: false, retryAt: 0 });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!ARKIV_READY) return;
    let alive = true;
    let timer;
    fn()
      .then((data) => alive && setState({ data, live: true, error: null, limited: false, retryAt: 0 }))
      .catch((error) => {
        if (!alive) return;
        const limited = Boolean(error?.limited);
        const retryAt = limited ? Date.now() + 61_000 : 0;
        setState((prev) => ({
          data: limited && prev.live ? prev.data : fallback, // keep real data rather than swap in demo data
          live: false,
          error: reads.redact(error?.shortMessage || error?.message || error),
          limited,
          retryAt,
        }));
        if (limited) timer = setTimeout(() => alive && setAttempt((n) => n + 1), retryAt - Date.now());
      });
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);
  return state;
}

/** App-wide: is Arkiv's free budget spent right now? { busy, retryInS, text } for a banner. */
export function useArkivBusy() {
  const [until, setUntil] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => reads.onBudget(setUntil), []);
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [until]);
  const retryInS = until ? Math.max(0, Math.ceil((until - Date.now()) / 1000)) : 0;
  return { busy: Boolean(until), retryInS, text: until ? `${ARKIV_BUSY_TEXT} in ${retryInS}s` : "" };
}

export const short = (h) => (h ? `${h.slice(0, 6)}…${h.slice(-4)}` : "");
/** Explorer links for an Arkiv entity or transaction. */
export const entityUrl = (key) => `${EXPLORER}/entity/${key}`;
export const txUrl = (hash) => `${EXPLORER}/tx/${hash}`;
