// "Verify payout": check a paid cleaning job across sponsors.
//   Arc:   the proofHash the escrow released the money on (read here, on chain)
//   Arkiv: the Pi's signed panel readings for the job's proof window. dy-arkiv's verifyJobPayout
//          checks every signature and recomputes the hash (lib/arkivProof.js)
// The payout is proven when every reading is signed by the Pi and their hash equals the hash on Arc.
import { useEffect, useState } from "react";
import { getJSON, useLive } from "./api.js";
import { ABI, ADDR, publicClient } from "./arc.js";
import { fetchReadings, verifyJobPayout } from "./arkiv.js";

// The Pi's device key (public): it signs every 1-minute meter summary. A connected Pi reports
// its own as `device` in GET /api/health, which wins; VITE_DEVICE_ADDRESS overrides the default.
export const DEVICE_ADDRESS = import.meta.env.VITE_DEVICE_ADDRESS || "0x1EADd21328207546a4785bE042499B9D228952Ed";
const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(a || "");
export const sameAddress = (a, b) => isAddr(a) && isAddr(b) && a.toLowerCase() === b.toLowerCase();

/** The device address to verify against: the live Pi's when connected, else the published one. */
export function usePiDevice() {
  const live = useLive();
  const [device, setDevice] = useState(DEVICE_ADDRESS);
  useEffect(() => {
    if (live.demo) return undefined;
    let alive = true;
    getJSON("/api/health")
      .then((h) => alive && isAddr(h?.device) && setDevice(h.device))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [live.demo]);
  return device;
}

/** The window the Pi hashed; older jobs without one: the 3 newest panel minutes at release time. */
async function windowFor(job) {
  if (job.proofWindow?.length === 2) return { window: job.proofWindow, how: "the proof window the Pi recorded" };
  const t = job.releasedAt || Math.floor(Date.now() / 1000);
  // bounded on both sides: an unbounded query returns the newest minutes, long after the payout
  const rows = (await fetchReadings({ meter: "panel", since: t - 15 * 60, until: t, limit: 60 })).sort((a, b) => b.minute - a.minute).slice(0, 3);
  if (rows.length < 3) return { window: null, how: null };
  return { window: [rows[2].minute, rows[0].minute], how: "the 3 newest panel minutes at release time" };
}

/**
 * job: { id (Arc job id), proofWindow? [from_minute, to_minute] (arc.proof_window), releasedAt? }
 * device: the Pi's device address (usePiDevice()); every reading must recover to exactly it.
 * Returns { ok, signaturesOk, hashOk, onChain, computed, signer, piSigner, rows, how, ogRequestId, why? }
 */
export async function verifyPayout(job, device = DEVICE_ADDRESS) {
  const chain = await publicClient.readContract({ address: ADDR.escrow, abi: ABI.escrow, functionName: "jobs", args: [BigInt(job.id)] });
  const [, , , , , , , onChain, ogStorageRoot, ogRequestId] = chain;
  if (/^0x0+$/.test(onChain)) return { ok: false, onChain, why: "No meter proof on Arc for this job (paid by a committee decision)." };

  const { window, how } = await windowFor(job);
  if (!window) return { ok: false, onChain, why: "Not enough signed panel readings on Arkiv around the release time." };
  // signatures are checked against the full device address, not whoever the rows claim signed
  const r = await verifyJobPayout({ proofWindow: window }, { expectedHash: onChain, device });
  if (r.reason) return { ok: false, onChain, why: r.reason };
  return {
    ok: r.ok,
    signaturesOk: r.signaturesOk,
    hashOk: r.hashOk,
    onChain,
    computed: r.computed,
    signer: r.signer,
    piSigner: sameAddress(r.signer, device),
    rows: r.readings,
    how,
    ogRequestId,
    ogStorageRoot,
  };
}
