// "Verify payout": recompute the meter proof of a paid cleaning job in the browser and compare
// it with the proofHash the escrow stored on Arc.
// The Pi's recipe (pi/cleaning.py _proof): sha256 of Python's
//   json.dumps([(minute, avg_w, sig) for the last 3 signed panel minutes])
// so the bytes must match Python's json.dumps exactly: ", " separators, floats as Python repr
// (1.0 not 1), None as null, minutes newest first.
import { ABI, ADDR, publicClient } from "./arc.js";
import { fetchReadings } from "./arkiv.js";

/** Python's repr() for a float, as json.dumps writes it. */
export function pyFloat(x) {
  if (!Number.isFinite(x)) throw new Error(`can't encode ${x}`);
  if (Number.isInteger(x)) return `${x}.0`;
  const a = Math.abs(x);
  if (a < 1e-4 || a >= 1e16) {
    const [m, e] = x.toExponential().split("e");
    const sign = e.startsWith("-") ? "-" : "+";
    return `${m}e${sign}${e.replace(/^[-+]/, "").padStart(2, "0")}`;
  }
  return String(x);
}

const pyStr = (s) => JSON.stringify(s); // hex signatures: ASCII only, same escaping as Python
const row = (r) => `[${r.minute}, ${pyFloat(r.avgW)}, ${r.sig == null ? "null" : pyStr(r.sig)}]`;
export const proofBlob = (rows) => `[${rows.map(row).join(", ")}]`;

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `0x${[...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Verify a paid job.
 * job: { id (Arc job id), proofWindow? [fromMinute, toMinute] (arc.proof_window), releasedAt? (unix s) }
 * Returns { ok, computed, onChain, rows, window, ogRequestId, ogStorageRoot, why? }
 */
export async function verifyPayout(job) {
  const chain = await publicClient.readContract({ address: ADDR.escrow, abi: ABI.escrow, functionName: "jobs", args: [BigInt(job.id)] });
  const [, , , , , , , proof, ogStorageRoot, ogRequestId] = chain;
  const onChain = proof;
  if (/^0x0+$/.test(onChain)) return { ok: false, onChain, why: "No meter proof on Arc for this job (paid by a committee decision)." };

  let rows;
  let window;
  if (job.proofWindow?.length === 2) {
    // the window the Pi hashed (Pi job arc.proof_window / Arkiv proofWindow), newest first
    const [from, to] = job.proofWindow;
    const all = await fetchReadings({ meter: "panel", since: from, limit: 120 });
    rows = all.filter((r) => r.minute >= from && r.minute <= to).sort((a, b) => b.minute - a.minute);
    window = "the proof window the Pi recorded";
    if (!rows.length) return { ok: false, onChain, rows, why: "The proof window's readings aren't on Arkiv yet." };
  } else {
    // older Pi: the 3 newest panel minutes at release time
    const t = job.releasedAt || Math.floor(Date.now() / 1000);
    const all = await fetchReadings({ meter: "panel", since: t - 15 * 60, limit: 60 });
    rows = all.filter((r) => r.minute <= t).sort((a, b) => b.minute - a.minute).slice(0, 3);
    window = "the 3 newest panel minutes at release time";
    if (rows.length < 3) return { ok: false, onChain, rows, why: "Not enough signed panel readings on Arkiv around the release time." };
  }
  const computed = await sha256Hex(proofBlob(rows));
  return { ok: computed.toLowerCase() === onChain.toLowerCase(), computed, onChain, rows, window, ogRequestId, ogStorageRoot };
}
