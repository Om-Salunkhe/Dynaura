// Reads Dynaura's records straight from Arkiv in the browser: no server in between,
// so anyone can check what the app shows. Only entities the building wallet created and still
// owns count (see arkivReads.js for the queries themselves).
import { useEffect, useState } from "react";
import * as reads from "./arkivReads.js";

export const OWNER = import.meta.env.VITE_ARKIV_OWNER || "";
export const BUILDING = import.meta.env.VITE_BUILDING_ID || "sunrise-apartments";
export const ARKIV_READY = /^0x[0-9a-fA-F]{40}$/.test(OWNER);
export const EXPLORER = "https://rabdi.explorer.arkiv.network";

// No access key in the browser, ever. rabdi() puts the key in the RPC URL, so anything in this
// bundle is public, and Arkiv's guidance keeps operator keys server-side (the bridge has ours).
// Keyless reads on the public endpoint, with jittered backoff, measured fine for our volume:
// 500/500 queries, 0 rate limits, at ~40 queries/s from one IP (arkiv/how-you-use-arkiv.md).
let ctx;
function arkiv() {
  if (!ctx) ctx = { client: reads.arkivClient(""), owner: OWNER, building: BUILDING };
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
/** Cleaner job board: fetchCleaningJobs({ status: "open" }) */
export const fetchCleaningJobs = (opts) => reads.cleaningJobs(arkiv(), opts);
/** Resident bills: fetchBills({ flat: "A" }) or fetchBills({ month: "2026-11" }) */
export const fetchBills = (opts) => reads.bills(arkiv(), opts);
/** Shop sales settled on Arc: fetchSales({ buyer: "0x..." }) */
export const fetchSales = (opts) => reads.sales(arkiv(), opts);
/** Daily totals (the same rows Dyna's planner reads), newest first. */
export const fetchDailyOutput = (days = 7) => reads.dailyOutput(arkiv(), days);
/** Signed 1-minute readings: fetchReadings({ meter: "panel", since: unixSeconds }) */
export const fetchReadings = (opts) => reads.readings(arkiv(), opts);

/** Run an Arkiv read; fall back to demo data when Arkiv isn't configured or reachable. */
export function useArkiv(fn, fallback, deps = []) {
  const [state, setState] = useState({ data: fallback, live: false, error: null });
  useEffect(() => {
    if (!ARKIV_READY) return;
    let alive = true;
    fn()
      .then((data) => alive && setState({ data, live: true, error: null }))
      .catch((error) => alive && setState({ data: fallback, live: false, error: reads.redact(error?.shortMessage || error) }));
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
