// "Verify payout": re-check, from Arkiv alone, what the cleaning escrow paid on.
//
// The Pi signs every 1-minute meter summary with its device key (pi/signer.py) and writes it to
// Arkiv. When the panel is clean again, it releases the Arc escrow with a proof hash over the panel
// readings it used (pi/cleaning.py). This file rebuilds both from the readings on Arkiv:
//   1. each reading's signature recovers to the Pi's device address
//   2. sha256 over the window's readings equals the proof hash the escrow released on
// Both are Python strings, so the numbers are formatted the way Python prints floats.
import { recoverMessageAddress, sha256, stringToBytes } from "viem";
import { readings } from "./arkivReads.js";

/** A number as Python's repr(float) prints it: 3.0, 0.000208, 1e-05, 1e+16. */
export function pyFloat(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) throw new Error(`not a finite number: ${x}`);
  if (n === 0) return Object.is(n, -0) ? "-0.0" : "0.0";
  const abs = Math.abs(n);
  if (abs >= 1e-4 && abs < 1e16) {
    const s = String(n); // shortest round-trip digits, like Python
    return s.includes(".") ? s : `${s}.0`;
  }
  const [m, e] = n.toExponential().split("e"); // "1e-5" -> Python "1e-05"
  const digits = e.slice(1).padStart(2, "0");
  return `${m}e${e[0]}${digits}`;
}

/** The exact text the Pi signed for one summary (pi/signer.py message_for). Keys sorted. */
export function readingMessage(r) {
  return (
    "dynaura:" +
    `{"avg_w":${pyFloat(r.avgW)},"meter":${JSON.stringify(r.meter)},"minute":${Math.trunc(r.minute)},` +
    `"samples":${Math.trunc(r.samples)},"solar_wh":${pyFloat(r.solarWh)},"wh":${pyFloat(r.wh)}}`
  );
}

/** Who signed this reading, and is it the expected device? */
export async function verifyReading(r, device = r.signer) {
  const recovered = await recoverMessageAddress({ message: readingMessage(r), signature: r.sig });
  return { recovered, ok: recovered.toLowerCase() === String(device).toLowerCase() };
}

/** The Pi's proof hash over panel readings, newest first (pi/cleaning.py _proof):
 *  sha256(json.dumps([(minute, avg_w, sig), ...], sort_keys=True)). */
export function proofHash(rowsNewestFirst) {
  const body = rowsNewestFirst.map((r) => `[${Math.trunc(r.minute)}, ${pyFloat(r.avgW)}, ${JSON.stringify(r.sig)}]`).join(", ");
  return sha256(stringToBytes(`[${body}]`));
}

/**
 * Verify a paid cleaning job against Arkiv.
 * job: { proofWindow: [fromMinute, toMinute], proofHash? } (e.g. a row of fetchCleaningJobs).
 * opts.expectedHash: the hash to compare with, e.g. the proofHash the escrow stored on Arc
 *   (preferred: it's what actually released the money); defaults to job.proofHash.
 * opts.device: the Pi's device address; defaults to the readings' own signer field.
 */
export async function verifyPayout(ctx, job, { device, expectedHash } = {}) {
  const expected = expectedHash ?? job?.proofHash;
  if (!job?.proofWindow || !expected) return { ok: false, reason: "this job has no proof window or proof hash" };
  const [from, to] = job.proofWindow;
  const rows = await readings(ctx, { meter: "panel", since: from, until: to, limit: 100 });
  if (!rows.length) return { ok: false, reason: "the window's readings are not on Arkiv (expired after 7 days?)" };
  const signer = device || rows[0].signer;
  const checked = await Promise.all(rows.map(async (r) => ({ ...r, signature: await verifyReading(r, signer) })));
  const computed = proofHash(rows);
  const signaturesOk = checked.every((r) => r.signature.ok);
  const hashOk = computed.toLowerCase() === String(expected).toLowerCase();
  return {
    ok: signaturesOk && hashOk,
    signaturesOk,
    hashOk,
    computed,
    expected,
    signer,
    window: [from, to],
    readings: checked.map((r) => ({ minute: r.minute, avgW: r.avgW, key: r.key, signatureOk: r.signature.ok })),
  };
}
