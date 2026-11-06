// Pure helpers for the bridge's records: value formatting and the cleaning-job payload (v3).
// No network, no keys: tested offline in jobs.test.mjs.
import { dec, u64 } from "@arkiv-network/sdk/schema"

export const nowS = () => Math.floor(Date.now() / 1000)

// Decimals as plain strings ("0.004167"), never scientific notation
export const d = (n, places = 6) => dec(Number(n || 0).toFixed(places).replace(/\.?0+$/, "") || "0")

// 0G proof fields: final names og_request_id / og_storage_root (DECISIONS 01:30). The old
// request_id / storage_root are still accepted from older Pi code.
export const ogRequestId = (b) => b.og_request_id ?? b.request_id
export const ogStorageRoot = (b) => b.og_storage_root ?? b.storage_root

export const JOB_STATES = ["flagged", "approved", "open", "accepted", "cleaned", "paid", "rejected", "refunded", "disputed", "resolved", "no_check"]
const LIVE_UNTIL_DEADLINE = new Set(["approved", "open", "accepted", "cleaned"])

const isNum = (v) => v !== undefined && v !== null && v !== "" && Number.isFinite(Number(v))
const txt = (v, n = 120) => (v === undefined || v === null || v === "" ? undefined : String(v).slice(0, n))
const unix = (v) => (isNum(v) ? u64(BigInt(Math.floor(Number(v)))) : undefined)
const teeOf = (t) => (typeof t === "boolean" ? t : t && typeof t === "object" ? Boolean(t.verified ?? t.ok ?? t.valid) : undefined)

/** A v3 Job (or a v2 flat job) as CleaningJob columns; fields the Pi didn't send are left out. */
export function jobColumns(b) {
  const og = b.og || {}
  const arc = b.arc || {}
  const win = arc.proof_window || b.proof_window || []
  const cols = {
    status: String(b.state ?? b.status ?? ""),
    case_id: txt(b.id, 64),
    job_id: unix(arc.job_id ?? b.job_id),
    created_at: unix(b.created_at),
    fee_usdc: isNum(b.fee_usdc) ? d(b.fee_usdc) : undefined,
    deadline: unix(b.deadline),
    dusty_pct: isNum(b.dusty_pct ?? b.output_before) ? d(b.dusty_pct ?? b.output_before, 1) : undefined,
    after_pct: isNum(b.after_pct ?? b.output_after) ? d(b.after_pct ?? b.output_after, 1) : undefined,
    coverage_pct: isNum(og.coverage_pct) ? d(og.coverage_pct, 1) : undefined,
    og_input: txt(og.input, 20),
    og_tee: teeOf(og.tee),
    og_request_id: txt(og.request_id ?? ogRequestId(b)),
    og_storage_root: txt(og.storage_root ?? ogStorageRoot(b)),
    proof_hash: txt(arc.proof_hash ?? b.proof_hash),
    proof_from: unix(win[0]),
    proof_to: unix(win[1]),
    open_tx: txt(arc.open_tx ?? b.open_tx),
    release_tx: txt(arc.release_tx ?? b.release_tx),
    refund_tx: txt(arc.refund_tx ?? b.refund_tx),
    arc_tx: txt(b.arc_tx ?? arc.release_tx ?? arc.refund_tx ?? arc.open_tx),
  }
  return Object.fromEntries(Object.entries(cols).filter(([, v]) => v !== undefined))
}

/** When a job in this state should expire (unix s), or null to leave its life alone. */
export function wantedEnd(status, deadline) {
  if (LIVE_UNTIL_DEADLINE.has(status) && isNum(deadline)) return Number(deadline) + 7 * 24 * 3600 // time to dispute
  if (status === "disputed") return nowS() + 7 * 24 * 3600
  return null
}

