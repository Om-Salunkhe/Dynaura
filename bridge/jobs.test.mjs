// Offline tests for the cleaning-job payload (flow v3) the Pi posts to POST /cleaning_job.
import assert from "node:assert/strict"
import { test } from "node:test"
import { jobColumns, JOB_STATES, wantedEnd } from "./jobs.mjs"

const v = (cols) => Object.fromEntries(Object.entries(cols).map(([k, x]) => [k, typeof x === "object" && x !== null && "value" in x ? x.value : x]))

test("a v3 Job flattens into columns, nested og and arc included", () => {
  const c = v(jobColumns({
    id: 7, state: "paid", fee_usdc: 2, deadline: 1_800_000_000, created_at: 1_799_990_000, dusty_pct: 52.34, after_pct: 94.06,
    og: { request_id: "zg-abc", tee: true, coverage_pct: 38.5, input: "vision", storage_root: "0x" + "cd".repeat(32), reason: "dust film" },
    arc: { job_id: 3, open_tx: "0x11", release_tx: "0x22", refund_tx: null, proof_hash: "0xee", proof_window: [1_799_999_880, 1_800_000_000] },
  }))
  assert.equal(c.status, "paid")
  assert.equal(c.case_id, "7")
  assert.equal(c.job_id, 3n)
  assert.equal(c.fee_usdc, "2")
  assert.equal(c.dusty_pct, "52.3")
  assert.equal(c.after_pct, "94.1")
  assert.equal(c.coverage_pct, "38.5")
  assert.equal(c.og_input, "vision")
  assert.equal(c.og_tee, true)
  assert.equal(c.og_request_id, "zg-abc")
  assert.equal(c.og_storage_root, "0x" + "cd".repeat(32))
  assert.equal(c.proof_hash, "0xee")
  assert.equal(c.proof_from, 1_799_999_880n)
  assert.equal(c.proof_to, 1_800_000_000n)
  assert.equal(c.release_tx, "0x22")
  assert.equal(c.arc_tx, "0x22")
  assert.ok(!("refund_tx" in c), "a null field is left out, not written empty")
  assert.ok(!("reason" in c), "the 0G reason lives on the dust decision, not the job")
})

test("a flagged job has no escrow yet: only what is known is written", () => {
  const c = v(jobColumns({ id: "8", state: "flagged", dusty_pct: 48, og: { request_id: "zg-1", tee: { verified: true } }, arc: {} }))
  assert.deepEqual(Object.keys(c).sort(), ["case_id", "dusty_pct", "og_request_id", "og_tee", "status"])
  assert.equal(c.og_tee, true)
})

test("the v2 flat payload still maps", () => {
  const c = v(jobColumns({ job_id: 5, status: "open", fee_usdc: 2, deadline: 1_800_000_000, output_before: 61, og_request_id: "zg-2" }))
  assert.equal(c.status, "open")
  assert.equal(c.job_id, 5n)
  assert.equal(c.dusty_pct, "61")
  assert.equal(c.og_request_id, "zg-2")
  assert.ok(!("case_id" in c))
})

test("lifetime follows the state", () => {
  const deadline = 1_800_000_000
  for (const s of ["approved", "open", "accepted", "cleaned"]) assert.equal(wantedEnd(s, deadline), deadline + 7 * 24 * 3600)
  for (const s of ["flagged", "paid", "rejected", "refunded", "resolved", "no_check"]) assert.equal(wantedEnd(s, deadline), null)
  const disputed = wantedEnd("disputed", deadline)
  assert.ok(Math.abs(disputed - (Math.floor(Date.now() / 1000) + 7 * 24 * 3600)) < 5)
  assert.equal(JOB_STATES.length, 11)
})

test("dy-arc's flat v3 payload: job_id is the Pi's id, arc_job_id the escrow", () => {
  const base = {
    job_id: 41, arc_job_id: null, fee_usdc: 2, created_at: 1_799_990_000, deadline: 1_799_990_000 + 86_400,
    output_before: 48.2, dusty_pct: 48.2, after_pct: null, output_after: null, og_request_id: "zg-dust-1",
    og_storage_root: null, proof_hash: null, open_tx: null, release_tx: null, refund_tx: null, arc_tx: null,
  }
  const flagged = v(jobColumns({ ...base, status: "flagged" }))
  assert.equal(flagged.case_id, "41")
  assert.ok(!("job_id" in flagged), "no Arc id before approval")
  assert.ok(!("deadline" in flagged), "a placeholder deadline before approval is not written")
  assert.equal(flagged.dusty_pct, "48.2")
  assert.equal(flagged.og_request_id, "zg-dust-1")
  assert.ok(!("og_storage_root" in flagged) && !("after_pct" in flagged))

  const open = v(jobColumns({ ...base, status: "open", arc_job_id: 3, deadline: 1_800_003_600, open_tx: "0x11", arc_tx: "0x11" }))
  assert.equal(open.case_id, "41")
  assert.equal(open.job_id, 3n)
  assert.equal(open.deadline, 1_800_003_600n)
  assert.equal(open.open_tx, "0x11")

  const paid = v(jobColumns({ ...base, status: "paid", arc_job_id: 3, after_pct: 93.7, output_after: 93.7, og_storage_root: "0xab", proof_hash: "0xee", release_tx: "0x22", arc_tx: "0x22", proof_window: [1_800_000_000, 1_800_000_120], cleaner: "0x390E0000000000000000000000000000000004F0", og_tee: true, coverage_pct: 35, og_input: "vision" }))
  assert.equal(paid.after_pct, "93.7")
  assert.equal(paid.proof_from, 1_800_000_000n)
  assert.equal(paid.og_tee, true)
  assert.equal(paid.coverage_pct, "35")
  assert.equal(paid.og_input, "vision")

  const noCheck = v(jobColumns({ ...base, job_id: 42, status: "no_check", fee_usdc: 0, og_request_id: null }))
  assert.equal(noCheck.status, "no_check")
  assert.equal(noCheck.case_id, "42")
  assert.equal(noCheck.fee_usdc, "0")
  assert.ok(!("deadline" in noCheck))
})

test("a v3-only state marks the payload v3 even without arc_job_id", () => {
  const c = v(jobColumns({ job_id: 5, status: "no_check", fee_usdc: 0, dusty_pct: 100 }))
  assert.equal(c.case_id, "5", "the Pi's id")
  assert.ok(!("job_id" in c), "not mistaken for an Arc escrow id")
  const old = v(jobColumns({ job_id: 5, status: "open", fee_usdc: 2 }))
  assert.equal(old.job_id, 5n, "a v2 state keeps the v2 meaning")
})
