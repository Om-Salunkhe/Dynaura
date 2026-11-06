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
