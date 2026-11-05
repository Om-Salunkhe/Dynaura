// Reads Dynaura's records straight from Arkiv in the browser: no server in between,
// so anyone can check what the app shows. Only entities owned by the building wallet count.
import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { desc, eq } from "@arkiv-network/sdk/query";
import { useEffect, useState } from "react";
import { hexToString, http } from "viem";
import { Decision, Heartbeat, Maintenance } from "./arkivSchemas.js";

export const OWNER = import.meta.env.VITE_ARKIV_OWNER || "";
export const BUILDING = import.meta.env.VITE_BUILDING_ID || "sunrise-apartments";
export const ARKIV_READY = /^0x[0-9a-fA-F]{40}$/.test(OWNER);

let client;
function arkiv() {
  if (!client) {
    client = createPublicClient({
      chain: rabdi({ accessKey: import.meta.env.VITE_ARKIV_ACCESS_KEY || "" }),
      transport: http(),
    });
  }
  return client;
}

const text = (v) => {
  try {
    return hexToString(v);
  } catch {
    return "";
  }
};

export async function fetchDecisions(limit = 20) {
  const page = await arkiv()
    .select({ $key: true, kind: true, mode: true, decision_id: true, day: true, request_id: true, storage_root: true, summary: true })
    .from(Decision)
    .where(eq("building", BUILDING))
    .ownedBy(OWNER)
    .orderBy(desc("decision_id"))
    .limit(limit)
    .fetch();
  return page.entities.map((e) => ({
    key: e.$key,
    kind: e.kind.value,
    mode: e.mode.value,
    id: Number(e.decision_id.value),
    day: e.day.value,
    requestId: e.request_id?.value,
    storageRoot: e.storage_root?.value,
    summary: text(e.summary.value),
  }));
}

export async function fetchMaintenance(limit = 20) {
  const page = await arkiv()
    .select({ $key: true, date: true, title: true, details: true, arc_tx: true })
    .from(Maintenance)
    .where(eq("building", BUILDING))
    .ownedBy(OWNER)
    .orderBy(desc("date"))
    .limit(limit)
    .fetch();
  return page.entities.map((e) => ({
    key: e.$key,
    date: e.date.value,
    title: e.title.value,
    text: text(e.details.value),
    arcTx: e.arc_tx?.value,
  }));
}

/** The building's heartbeat entity: if it expired (Pi off > 2 min), there is none. */
export async function fetchHeartbeat() {
  const page = await arkiv()
    .select({ $key: true, mode: true, flats: true, pump: true, updated: true, $expiresAt: true })
    .from(Heartbeat)
    .where(eq("building", BUILDING))
    .ownedBy(OWNER)
    .limit(1)
    .fetch();
  const e = page.entities[0];
  return e ? { key: e.$key, mode: e.mode.value, flats: e.flats.value, pump: e.pump.value, updated: Number(e.updated.value) } : null;
}

/** Run an Arkiv read; fall back to demo data when Arkiv isn't configured or reachable. */
export function useArkiv(fn, fallback, deps = []) {
  const [state, setState] = useState({ data: fallback, live: false, error: null });
  useEffect(() => {
    if (!ARKIV_READY) return;
    let alive = true;
    fn()
      .then((data) => alive && setState({ data, live: true, error: null }))
      .catch((error) => alive && setState({ data: fallback, live: false, error: String(error?.shortMessage || error) }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

export const short = (h) => (h ? `${h.slice(0, 6)}…${h.slice(-4)}` : "");
