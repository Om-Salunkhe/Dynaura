// Live end-to-end check on Rabdi: post one sample of every Dynaura record to a running bridge,
// then read each back with the web app's own queries (web/src/lib/arkivReads.js) and time it all.
//
//   BUILDING_ID=test-<you>-1 npm start      # in one terminal, with a TEST wallet and building id
//   npm run smoke                           # in another (needs `npm ci` in ../web for the reads)
//
// Never point this at the demo building: it refuses to run against "sunrise-apartments".
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"

const BRIDGE = process.env.BRIDGE_URL || "http://127.0.0.1:5100"
const reads = await import("../web/src/lib/arkivReads.js")

// viem errors quote the RPC URL, which carries the access key: never print one raw.
const say = (e) => reads.redact(String(e?.shortMessage || e?.message || e).split("\n")[0])
for (const ev of ["uncaughtException", "unhandledRejection"]) {
  process.on(ev, (e) => {
    console.error(`smoke crashed: ${say(e)}`)
    process.exit(1)
  })
}

const results = []
let failures = 0

async function step(name, fn) {
  const t0 = performance.now()
  try {
    const out = await fn()
    const ms = Math.round(performance.now() - t0)
    results.push({ step: name, ms, ok: true })
    const note = out?.note ?? out?.txHash
    console.log(`ok   ${String(ms).padStart(6)} ms  ${name}${note ? `  (${note})` : ""}`)
    return out
  } catch (e) {
    const ms = Math.round(performance.now() - t0)
    failures++
    results.push({ step: name, ms, ok: false, error: say(e) })
    console.log(`FAIL ${String(ms).padStart(6)} ms  ${name}: ${say(e)}`)
    return null
  }
}

async function call(method, path, body) {
  const r = await fetch(`${BRIDGE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
  const out = await r.json()
  if (!r.ok) throw new Error(`${path}: ${r.status} ${out.error || JSON.stringify(out)}`)
  return out
}
const post = (path, body) => call("POST", path, body)

function expect(cond, msg) {
  if (!cond) throw new Error(`mismatch: ${msg}`)
}

// ---- setup -------------------------------------------------------------------------------
const health = await call("GET", "/health")
if (health.building === "sunrise-apartments") {
  console.error("The bridge is writing to the demo building. Restart it with BUILDING_ID=test-<you>-<n>.")
  process.exit(1)
}
console.log(`bridge ${BRIDGE} · wallet ${health.wallet} · building ${health.building} · block ${health.block}\n`)
const ctx = { client: reads.arkivClient(process.env.ARKIV_ACCESS_KEY || ""), owner: health.wallet, building: health.building }
const entity = (k) => reads.withBackoff(() => ctx.client.getEntity(k))

const now = Math.floor(Date.now() / 1000)
const minute = now - (now % 60)
const today = new Date().toISOString().slice(0, 10)
const month = today.slice(0, 7)
const run = now % 1_000_000 // keeps ids unique across runs
const device = privateKeyToAccount(generatePrivateKey()) // stands in for the Pi's device key
const shop = privateKeyToAccount(generatePrivateKey()).address

// ---- writes, one at a time (the order the Pi would send them in a day) --------------------
const summaries = await Promise.all(
  ["panel", "A", "B", "C"].map(async (meter, i) => {
    const s = { minute, meter, avg_w: 1.25 + i, wh: 0.0208 + i / 100, solar_wh: 0.02, samples: 60 }
    return { ...s, signer: device.address, sig: await device.signMessage({ message: JSON.stringify(s) }) }
  }),
)
const rd = await step("write readings (4 meters, 1 batch tx)", async () => {
  const r = await post("/readings", { summaries })
  expect(r.created === 4, `created ${r.created}`)
  return { ...r, note: r.txHash }
})

await step("same readings posted again (a resend after a lost reply) create nothing", async () => {
  const r = await post("/readings", { summaries })
  expect(r.created === 0 && r.existing === 4, JSON.stringify(r))
  return { note: "0 created, 4 already there" }
})

const hb1 = await step("write heartbeat", () => post("/heartbeat", { mode: "plan", flats: { A: "solar", B: "grid", C: "solar" }, pump: true, solar_w: 3.2, used_w: 2.9 }))
const hb1Expiry = hb1 && (await entity(hb1.key)).$expiresAt
await step("read heartbeat (web: Admin online badge)", async () => {
  const h = await reads.heartbeat(ctx)
  expect(h && h.key === hb1?.key, `heartbeat key ${h?.key} vs ${hb1?.key}`)
  return { ...h, note: `expires in ${h.expiresInS}s` }
})
const hb2 = await step("renew heartbeat (patch + extend, 1 tx)", async () => {
  const r = await post("/heartbeat", { mode: "plan", flats: { A: "solar", B: "solar", C: "solar" }, pump: false, solar_w: 3.4, used_w: 2.1 })
  expect(r.renewed && r.key === hb1?.key, "heartbeat should be renewed in place")
  return r
})
await step("heartbeat renew moved the expiry forward", async () => {
  const h = await reads.heartbeat(ctx)
  expect(h.flats === "A:solar,B:solar,C:solar", `flats ${h.flats}`)
  const after = (await entity(hb2.key)).$expiresAt
  expect(after > hb1Expiry, `expiresAt ${hb1Expiry} -> ${after}`)
  return { note: `block ${hb1Expiry} -> ${after}, ${h.expiresInS}s left` }
})

const decisionId = 900_000 + (run % 99_999)
const dec = await step("write decision (0G plan with proof)", () =>
  post("/decision", {
    decision_id: decisionId,
    kind: "plan",
    mode: "ai",
    day: today,
    og_request_id: `smoke-${run}`,
    model: "0gm-1.0-35b-a3b",
    og_storage_root: "0x" + "ab".repeat(32),
    summary: "Smoke test: pump at 12:00, Flat B away so its share goes to A. ".repeat(4),
  }),
)

await step("same decision posted again is not created twice", async () => {
  const r = await post("/decision", { decision_id: decisionId, kind: "plan", mode: "ai", day: today, summary: "resend" })
  expect(r.existing && r.key === dec?.key, JSON.stringify(r))
  return { note: "existing key returned" }
})

// 0G Storage was offline: the decision goes to Arkiv without its root, and the root is patched in
// once when the upload lands (DECISIONS 01:30). A second, different root is refused.
const late = await step("write decision without its 0G root (0G offline)", async () => {
  const r = await post("/decision", { decision_id: decisionId + 2, kind: "cleaning", mode: "meter", day: today, og_request_id: `smoke-dust-${run}`, summary: "Smoke: panel at 52%, dust check" })
  expect(r.sealed === false, "a decision without its root must stay patchable")
  return r
})
await step("late 0G root patched into the same decision", async () => {
  const r = await post("/decision", { decision_id: decisionId + 2, arkiv_key: late.key, og_storage_root: "0x" + "cd".repeat(32) })
  expect(r.patched === true && r.key === late.key, "patched in place") // the read-back is checked below
  return r
})
await step("a different root for the same decision is refused", async () => {
  try {
    await post("/decision", { decision_id: decisionId + 2, arkiv_key: late.key, og_storage_root: "0x" + "ef".repeat(32) })
  } catch (e) {
    expect(/409|already has/.test(e.message), e.message)
    return { note: "409" }
  }
  throw new Error("second root was accepted")
})

const d1 = await step("write daily totals (create)", () => post("/daily", { day: today, panel_wh: 12.5, flats_wh: 10.1, solar_pct: 81.2 }))
const d1Entity = d1 && (await entity(d1.key))
const d2 = await step("write daily totals again (patch)", async () => {
  const r = await post("/daily", { day: today, panel_wh: 14.0, flats_wh: 11.0, solar_pct: 83.4 })
  expect(r.patched && r.key === d1?.key, "second daily post should patch the same entity")
  return r
})
await step("patch kept the expiry (daily_output)", async () => {
  const after = await entity(d2.key)
  expect(after.$expiresAt === d1Entity.$expiresAt, `expiresAt ${d1Entity.$expiresAt} -> ${after.$expiresAt}`)
  return { note: `still block ${after.$expiresAt}` }
})

const off = await step("write shop offer (expires when the window closes)", () =>
  post("/offer", { day: today, kwh: 0.42, price_usdc: 0.08, window_end: now + 10 * 60, og_request_id: `smoke-${run}` }),
)

// Cleaning flow v3, in dy-arc's flat payload (pi/cleaning.py): job_id is the PI's job id and
// arc_job_id the escrow id once approved. The bridge maps them to case_id / job_id on Arkiv.
const jobId = 800_000 + (run % 99_999) // Arc escrow id, known from approval on
const piJobId = 700_000 + (run % 99_999)
const caseId = String(piJobId)
const deadline = now + 60 * 60
const cleaner = privateKeyToAccount(generatePrivateKey()).address // the cleaner's wallet
const job = (status, extra = {}) => ({
  job_id: piJobId, arc_job_id: null, status, fee_usdc: 2, created_at: now, deadline: now + 86_400,
  output_before: 52.3, dusty_pct: 52.3, after_pct: null, output_after: null,
  og_request_id: `smoke-dust-${run}`, og_storage_root: null, og_tee: true, coverage_pct: 38.5, og_input: "vision",
  proof_hash: null, open_tx: null, release_tx: null, refund_tx: null, arc_tx: null, ...extra,
})
const j1 = await step("cleaning job flagged by 0G (create, no escrow yet)", () => post("/cleaning_job", job("flagged")))
const j1Entity = j1 && (await entity(j1.key))
await step("a flag nobody approves lapses in 48 h", async () => {
  const head = await ctx.client.getBlockNumber()
  const hours = (Number(j1Entity.$expiresAt - head) * 2) / 3600
  expect(hours > 47 && hours <= 48, `${hours.toFixed(2)} h`)
  return { note: `${hours.toFixed(1)} h left` }
})
const j2 = await step("admin approves (patch + extend to deadline + 7 days)", async () => {
  const r = await post("/cleaning_job", job("approved", { deadline }))
  expect(r.key === j1.key && r.patched && r.extended, JSON.stringify(r))
  return r
})
const j2Entity = j2 && (await entity(j2.key))
await step("escrow open on Arc -> open (patch)", () => post("/cleaning_job", job("open", { deadline, arc_job_id: jobId, open_tx: "0x" + "11".repeat(32), arc_tx: "0x" + "11".repeat(32) })))
await step("cleaner accepts -> accepted (patch)", () => post("/cleaning_job", job("accepted", { deadline, arc_job_id: jobId, open_tx: "0x" + "11".repeat(32) })))
await step("cleaner marks done -> cleaned (patch)", () => post("/cleaning_job", job("cleaned", { deadline, arc_job_id: jobId, open_tx: "0x" + "11".repeat(32) })))
const j3 = await step("meter proves it: paid at 94% (patch)", () =>
  post("/cleaning_job", job("paid", {
    deadline, arc_job_id: jobId, after_pct: 94.1, output_after: 94.1, og_storage_root: "0x" + "cd".repeat(32),
    open_tx: "0x" + "11".repeat(32), release_tx: "0x" + "22".repeat(32), arc_tx: "0x" + "22".repeat(32),
    proof_hash: "0x" + "ee".repeat(32), proof_window: [minute - 120, minute], cleaner,
  })),
)
await step("paid job: a work receipt made by the building, owned by the cleaner", async () => {
  const rc = j3?.receipt
  expect(rc && rc.issued && rc.owner === cleaner && rc.key, `receipt ${JSON.stringify(rc)}`)
  const e = await entity(rc.key)
  expect(e.$creator.toLowerCase() === health.wallet.toLowerCase(), "created by the building")
  expect(e.$owner.toLowerCase() === cleaner.toLowerCase(), "owned by the cleaner")
  expect(e.$creationFlags?.readonly === true && e.$creationFlags?.permissionlessExtension === true, "sealed, anyone may extend")
  const again = await post("/work_receipt", { job_id: piJobId, arc_job_id: jobId, cleaner, status: "paid", fee_usdc: 2 })
  expect(again.key === rc.key && again.issued === false, "issued once")
  const mine = await reads.workReceipts(ctx, { cleaner })
  expect(mine.length === 1 && mine[0].key === rc.key && mine[0].afterPct === 94.1, `cleaner's history ${JSON.stringify(mine)}`)
  return { note: `${rc.key.slice(0, 10)}… owner ${cleaner.slice(0, 8)}…` }
})
await step("later patches kept the expiry (cleaning_job)", async () => {
  const after = await entity(j3.key)
  expect(after.$expiresAt === j2Entity.$expiresAt, `expiresAt ${j2Entity.$expiresAt} -> ${after.$expiresAt}`)
  expect(j2Entity.$expiresAt > j1Entity.$expiresAt, "approval extended it")
  return { note: `block ${j1Entity.$expiresAt} -> ${j2Entity.$expiresAt}, then unchanged` }
})
await step("v2 flat job still accepted", async () => {
  const r = await post("/cleaning_job", { job_id: jobId + 1, status: "open", fee_usdc: 2, deadline, output_before: 61 })
  expect(r.key && !r.patched, JSON.stringify(r))
  return r
})

const mnt = await step("write maintenance record", () =>
  post("/maintenance", { date: today, title: "Panel cleaned (smoke)", details: "Output 52% -> 94%. Paid 2.00 USDC from Arc escrow.", arc_tx: "0x" + "22".repeat(32) }),
)
const sale = await step("write shop sale", () => post("/sale", { order_id: run, buyer: shop, buyer_name: "Smoke Kirana", kwh: 0.3, usdc: 0.024, arc_tx: "0x" + "33".repeat(32) }))
const billKeys = []
for (const flat of ["A", "B", "C"]) {
  const b = await step(`write bill flat ${flat}`, () => post("/bill", { flat, month, kwh: 41.5, solar_pct: 72, usdc: 0.62, arc_tx: "0x" + "44".repeat(32) }))
  billKeys.push(b?.key)
}
await step("bills, sales, readings, complete decisions are sealed; heartbeat, late decision are not", async () => {
  const sealed = await Promise.all([billKeys[0], sale?.key, rd?.keys?.[0], dec?.key].map((k) => entity(k)))
  expect(sealed.every((e) => e.$creationFlags?.readonly === true), "readonly flag on fact records")
  const open = await Promise.all([hb1.key, late.key].map((k) => entity(k)))
  expect(open.every((e) => e.$creationFlags?.readonly === false), "heartbeat and late-root decision must stay patchable")
  return { note: "4 sealed, 2 patchable" }
})

// ---- the queue: posts that arrive together are written one by one, never on the same nonce --
await step("3 writes posted at once all land (serialized queue)", async () => {
  const rs = await Promise.all([
    post("/maintenance", { date: today, title: "Inverter check (smoke)", details: "Concurrent write 1" }),
    post("/maintenance", { date: today, title: "Wiring check (smoke)", details: "Concurrent write 2" }),
    post("/decision", { decision_id: decisionId + 1, kind: "ask", mode: "ai", day: today, summary: "Concurrent write 3" }),
  ])
  expect(new Set(rs.map((r) => r.txHash)).size === 3, "three distinct transactions")
  return { note: rs.map((r) => r.txHash.slice(0, 8)).join(" ") }
})
await step("heartbeats posted at once share one write (coalesced)", async () => {
  const hb = (pump) => post("/heartbeat", { mode: "plan", flats: { A: "solar", B: "grid", C: "grid" }, pump, solar_w: 1, used_w: 1 })
  const rs = await Promise.all([hb(false), hb(true), hb(false), hb(true)])
  const txs = new Set(rs.map((r) => r.txHash))
  expect(rs.every((r) => r.key === hb1?.key), "same heartbeat entity")
  expect(txs.size < rs.length, `${txs.size} txs for ${rs.length} heartbeats`)
  return { note: `${rs.length} posts -> ${txs.size} txs` }
})

// ---- reads, exactly as the screens make them ----------------------------------------------
await step("read decisions (web: History, Home)", async () => {
  const rows = await reads.decisions(ctx, 5)
  const d = rows.find((x) => x.key === dec?.key)
  expect(d && d.id === decisionId && d.requestId === `smoke-${run}` && d.summary.startsWith("Smoke test"), "decision row")
  return { note: `${rows.length} rows` }
})
await step("job -> its 0G decision by og_request_id (web: proof chip)", async () => {
  const d = await reads.decisionByOgRequest(ctx, `smoke-dust-${run}`)
  expect(d && d.key === late?.key && d.storageRoot === "0x" + "cd".repeat(32), `decision ${JSON.stringify(d)}`)
  return { note: `decision #${d.id}` }
})
await step("read maintenance (web: Admin upkeep, History)", async () => {
  const rows = await reads.maintenance(ctx, 5)
  expect(rows.some((x) => x.key === mnt?.key && x.text.includes("52%")), "maintenance row")
  return { note: `${rows.length} rows` }
})
await step("read offers (web: Shop offers)", async () => {
  const rows = await reads.offers(ctx)
  expect(rows.some((x) => x.key === off?.key && x.kwh === 0.42), "offer row")
  return { note: `${rows.length} live offers` }
})
await step("read cleaning jobs with status=paid (web: Cleaner jobs)", async () => {
  const rows = await reads.cleaningJobs(ctx, { status: "paid" })
  const j = rows.find((x) => x.caseId === caseId)
  expect(j && j.jobId === jobId && j.afterPct === 94.1 && j.dustyPct === 52.3 && j.outputBefore === 52.3, `paid job row ${JSON.stringify(j)}`)
  expect(j.ogRequestId === `smoke-dust-${run}` && j.ogStorageRoot === "0x" + "cd".repeat(32) && j.ogTee === true && j.ogInput === "vision" && j.coveragePct === 38.5, "0G verdict on the job")
  expect(j.proofHash === "0x" + "ee".repeat(32) && j.proofWindow?.[1] === minute && j.releaseTx === "0x" + "22".repeat(32) && j.openTx === "0x" + "11".repeat(32), "Arc proof on the job")
  const live = await reads.cleaningJobs(ctx, { statuses: ["flagged", "open", "accepted", "cleaned"] })
  expect(!live.some((x) => x.caseId === caseId), "a paid job must not show as live")
  const v2 = (await reads.cleaningJobs(ctx, { status: "open" })).find((x) => x.jobId === jobId + 1)
  expect(v2 && v2.outputBefore === 61 && v2.feeUsdc === 2, "v2 job reads with its old fields")
  return { note: `${rows.length} paid` }
})
await step("read bills for flat A (web: Bill)", async () => {
  const rows = await reads.bills(ctx, { flat: "A" })
  expect(rows.some((x) => x.month === month && x.usdc === 0.62), "bill row")
  return { note: `${rows.length} rows` }
})
await step("read sales by buyer (web: Admin trading)", async () => {
  const rows = await reads.sales(ctx, { buyer: shop })
  expect(rows.length === 1 && rows[0].key === sale?.key && rows[0].orderId === run, "sale row")
  return { note: rows[0].name }
})
await step("read daily totals (Dyna's planner prompt)", async () => {
  const rows = await reads.dailyOutput(ctx, 7)
  expect(rows[0]?.day === today && rows[0].panelWh === 14, `daily row ${JSON.stringify(rows[0])}`)
  return { note: `${rows.length} days` }
})
await step("bridge GET /history (what the Pi feeds the planner)", async () => {
  const rows = await call("GET", "/history?days=7")
  expect(rows[0]?.day === today, "history row")
  return { note: `${rows.length} days` }
})
await step("read panel readings since this minute (signed by the device)", async () => {
  const rows = await reads.readings(ctx, { meter: "panel", since: minute })
  const r = rows.find((x) => x.minute === minute)
  expect(r && r.signer.toLowerCase() === device.address.toLowerCase() && r.avgW === 1.25, "reading row")
  return { note: `${rows.length} rows, keys from tx ${rd?.txHash?.slice(0, 10)}…` }
})
await step("trust: a stranger's entity with our tags is ignored", async () => {
  // Same schema and building tag, but read as if the stranger were the owner: our rows vanish.
  const other = { ...ctx, owner: privateKeyToAccount(generatePrivateKey()).address }
  const rows = await reads.decisions(other, 5)
  expect(rows.length === 0, "rows from another owner")
  return { note: "0 rows" }
})

// ---- summary -----------------------------------------------------------------------------
const isWrite = (r) => r.step.startsWith("write") || r.step.startsWith("renew") || r.step.includes("-> ")
const writes = results.filter((r) => r.ok && isWrite(r))
const readsDone = results.filter((r) => r.ok && r.step.startsWith("read"))
const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, r) => a + r.ms, 0) / xs.length) : 0)
console.log(`\n${results.length - failures}/${results.length} passed · writes avg ${avg(writes)} ms (n=${writes.length}) · reads avg ${avg(readsDone)} ms (n=${readsDone.length})`)
const after = await call("GET", "/health")
console.log("bridge health after:", JSON.stringify(after))
process.exit(failures ? 1 : 0)
