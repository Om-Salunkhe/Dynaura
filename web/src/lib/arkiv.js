// Reads Dynaura's records straight from Arkiv in the browser: no server in between,
// so anyone can check what the app shows. Only entities the building wallet created and still
// owns count (see arkivReads.js for the queries themselves).
import { useEffect, useState } from "react";
import { verifyPayout } from "./arkivProof.js";
import * as reads from "./arkivReads.js";

export const OWNER = import.meta.env.VITE_ARKIV_OWNER || "";
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
/** Resident bills: fetchBills({ flat: "A" }) or fetchBills({ month: "2026-11" }) */
export const fetchBills = (opts) => reads.bills(arkiv(), opts);
/** Shop sales settled on Arc: fetchSales({ buyer: "0x..." }) */
export const fetchSales = (opts) => reads.sales(arkiv(), opts);
/** Daily totals (the same rows Dyna's planner reads), newest first. */
export const fetchDailyOutput = (days = 7) => reads.dailyOutput(arkiv(), days);
/** Signed 1-minute readings: fetchReadings({ meter: "panel", since: unixSeconds }) */
export const fetchReadings = (opts) => reads.readings(arkiv(), opts);

/** "Verify payout" for a paid job from fetchCleaningJobs: re-fetches its signed panel readings from
 *  Arkiv, checks every signature against the Pi's device key and recomputes the escrow's proof hash.
 *  Returns { ok, signaturesOk, hashOk, computed, expected, signer, window, readings }. */
export const verifyJobPayout = (job, opts) => verifyPayout(arkiv(), job, opts);

/** Run an Arkiv read; fall back to demo data when Arkiv isn't configured or reachable. */
export function useArkiv(fn, fallback, deps = []) {
  // limited = Arkiv's free public endpoint is out of queries (429 ANON_COST_LIMITED): a busy
  // network, not a broken building. Screens can say "Arkiv busy" rather than "not reachable".
  const [state, setState] = useState({ data: fallback, live: false, error: null, limited: false });
  useEffect(() => {
    if (!ARKIV_READY) return;
    let alive = true;
    fn()
      .then((data) => alive && setState({ data, live: true, error: null, limited: false }))
      .catch(
        (error) =>
          alive && setState({ data: fallback, live: false, error: reads.redact(error?.shortMessage || error?.message || error), limited: Boolean(error?.limited) }),
      );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

export const short = (h) => (h ? `${h.slice(0, 6)}…${h.slice(-4)}` : "");
/** Explorer links for an Arkiv entity or transaction. */
export const entityUrl = (key) => `${EXPLORER}/entity/${key}`;
export const txUrl = (hash) => `${EXPLORER}/tx/${hash}`;
