// "Verify payout": check a paid cleaning job across sponsors.
//   Arc:   the proofHash the escrow released the money on (read here, on chain)
//   Arkiv: the Pi's signed panel readings for the job's proof window. dy-arkiv's verifyJobPayout
//          checks every signature and recomputes the hash (lib/arkivProof.js)
// The payout is proven when every reading is signed by the Pi and their hash equals the hash on Arc.
import { ABI, ADDR, publicClient } from "./arc.js";
import { fetchReadings, verifyJobPayout } from "./arkiv.js";

// The Pi's device key as published in arkiv/how-you-use-arkiv.md (0x1EADd213…52Ed)
export const isPiDevice = (a) => /^0x1eadd213[0-9a-f]{26}52ed$/i.test(a || "");

/** The window the Pi hashed; older jobs without one: the 3 newest panel minutes at release time. */
async function windowFor(job) {
  if (job.proofWindow?.length === 2) return { window: job.proofWindow, how: "the proof window the Pi recorded" };
  const t = job.releasedAt || Math.floor(Date.now() / 1000);
  const rows = (await fetchReadings({ meter: "panel", since: t - 15 * 60, limit: 60 })).filter((r) => r.minute <= t).sort((a, b) => b.minute - a.minute).slice(0, 3);
  if (rows.length < 3) return { window: null, how: null };
  return { window: [rows[2].minute, rows[0].minute], how: "the 3 newest panel minutes at release time" };
}

/**
 * job: { id (Arc job id), proofWindow? [from_minute, to_minute] (arc.proof_window), releasedAt? }
 * Returns { ok, signaturesOk, hashOk, onChain, computed, signer, piSigner, rows, how, ogRequestId, why? }
 */
export async function verifyPayout(job) {
  const chain = await publicClient.readContract({ address: ADDR.escrow, abi: ABI.escrow, functionName: "jobs", args: [BigInt(job.id)] });
  const [, , , , , , , onChain, ogStorageRoot, ogRequestId] = chain;
  if (/^0x0+$/.test(onChain)) return { ok: false, onChain, why: "No meter proof on Arc for this job (paid by a committee decision)." };

  const { window, how } = await windowFor(job);
  if (!window) return { ok: false, onChain, why: "Not enough signed panel readings on Arkiv around the release time." };
  const r = await verifyJobPayout({ proofWindow: window }, { expectedHash: onChain });
  if (r.reason) return { ok: false, onChain, why: r.reason };
  return {
    ok: r.ok,
    signaturesOk: r.signaturesOk,
    hashOk: r.hashOk,
    onChain,
    computed: r.computed,
    signer: r.signer,
    piSigner: isPiDevice(r.signer),
    rows: r.readings,
    how,
    ogRequestId,
    ogStorageRoot,
  };
}
