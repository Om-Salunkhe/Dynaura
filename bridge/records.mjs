// The routes the Pi calls. Each one writes Arkiv entities owned by the building wallet.
// Every write goes through write() (one queue, explicit nonce, reconcile, never resend blindly).
import { ExpirationTime } from "@arkiv-network/sdk"
import { and, desc, eq, lte } from "@arkiv-network/sdk/query"
import { addr, u64 } from "@arkiv-network/sdk/schema"
import { hexToBytes, stringToBytes } from "viem"
import { account, addHealth, BUILDING, publicClient, read, route, walletClient, write } from "./bridge.mjs"
import { d, jobColumns, JOB_STATES, ogRequestId, ogStorageRoot, wantedEnd } from "./jobs.mjs"
import { redact } from "./retry.mjs"
import { Bill, CleaningJob, DailyOutput, Decision, Heartbeat, Maintenance, Offer, Reading, Sale } from "./schemas.mjs"

export const days = (n) => ExpirationTime.fromDays(n)
const nowS = () => Math.floor(Date.now() / 1000)
/** Expire at a wall-clock time (unix seconds), but never sooner than `min` from now. */
const until = (unixS, min = ExpirationTime.fromMinutes(2)) => ExpirationTime.atDate(new Date(unixS * 1000), { atLeast: min })

/** Records that are facts once written (a bill, a sale, a signed reading, a decision) are created
 *  readonly: Arkiv refuses any later change to their contents, even from the building wallet.
 *  Their expiry can still be extended (the keeper does), and the owner can still delete them. */
const SEALED = { readonly: true }

/** Only entities this wallet created and still owns are ours, whatever their tags say. */
const ours = (q) => q.createdBy(account.address).ownedBy(account.address)

// POST /readings  {"summaries": [{minute, meter, avg_w, wh, solar_wh, samples, signer, sig}, ...]}
// One transaction per minute for all meters (a batch is all-or-nothing).
route("POST", "/readings", async (body) => {
  const rows = body.summaries || []
  if (!rows.length) return { created: 0 }
  const creates = rows.map((s) => ({
    schema: Reading,
    values: {
      building: BUILDING,
      meter: String(s.meter),
      minute: u64(BigInt(s.minute)),
      avg_w: d(s.avg_w),
      wh: d(s.wh),
      solar_wh: d(s.solar_wh),
      samples: u64(BigInt(s.samples)),
      signer: addr(s.signer),
      sig: hexToBytes(s.sig),
    },
    expiration: days(7),
    flags: SEALED,
  }))
  const r = await write("readings", (tx) => walletClient.executeBatch({ creates }, tx), { ops: creates.length })
  return { created: r.createdEntities.length, txHash: r.txHash, keys: r.createdEntities }
})

// POST /heartbeat  {mode, flats: {A: "solar", ...}, pump: true, solar_w, used_w}
// One entity, patched and extended to "2 more minutes" each time. If the Pi stops, it expires
// and the app shows "Building offline": no cron job, no server, the expiry is the alarm.
// A patch never moves the expiry (checked live), so the renewal is patch + extend in one tx.
let heartbeatKey = null
let heartbeatLookedUp = false
let heartbeatRenewedAt = 0

async function findHeartbeat() {
  const page = await read(() =>
    ours(publicClient.select({ $key: true }).from(Heartbeat).where(eq("building", BUILDING)))
      .orderBy(desc("updated"))
      .limit(1)
      .fetch(),
  )
  return page.entities[0]?.$key ?? null
}

const gone = (e) => /expired|no entity/i.test(String(e?.message || e))

route("POST", "/heartbeat", async (b) => {
  const values = {
    mode: String(b.mode || "unknown"),
    flats: Object.entries(b.flats || {}).map(([f, s]) => `${f}:${s}`).join(","),
    pump: b.pump ? "on" : "off",
    solar_w: d(b.solar_w, 4),
    used_w: d(b.used_w, 4),
    updated: u64(BigInt(nowS())),
  }
  const ttl = ExpirationTime.fromMinutes(2)
  return write(
    "heartbeat",
    async (tx) => {
      // After a restart, pick up the heartbeat that is still alive instead of starting a second one.
      if (!heartbeatKey && !heartbeatLookedUp) {
        heartbeatLookedUp = true
        heartbeatKey = await findHeartbeat()
      }
      // Writes skip the gas estimate (see writer.mjs), so nothing would stop a patch on an expired
      // heartbeat before it is mined. If the last renewal is old, check the entity is still there.
      if (heartbeatKey && Date.now() - heartbeatRenewedAt > 100_000) {
        const alive = await read(() => publicClient.getEntity(heartbeatKey)).then(() => true, (e) => (e?.name === "NoEntityFoundError" ? false : Promise.reject(e)))
        if (!alive) heartbeatKey = null
      }
      if (heartbeatKey) {
        try {
          const r = await walletClient.executeBatch(
            { patches: [{ schema: Heartbeat, entityKey: heartbeatKey, set: values }], extensions: [{ entityKey: heartbeatKey, expiration: ttl }] },
            tx,
          )
          heartbeatRenewedAt = Date.now()
          return { key: heartbeatKey, txHash: r.txHash, renewed: true }
        } catch (e) {
          // Only a heartbeat that is really gone (Pi was off > 2 min) is replaced. Any other error
          // (rate limit, network) must not start a second heartbeat next to the live one.
          if (!gone(e)) throw e
          console.warn("heartbeat expired, starting a new one")
          heartbeatKey = null
          if (e?.txHash) throw e // a reverted tx used this nonce; the next heartbeat creates it
        }
      }
      const r = await walletClient.createEntity(Heartbeat, { building: BUILDING, ...values }, { expiration: ttl }, tx)
      heartbeatKey = r.entityKey
      heartbeatRenewedAt = Date.now()
      return { key: r.entityKey, txHash: r.txHash, renewed: false }
    },
    { coalesce: "heartbeat", ops: 2 },
  )
})

addHealth(async (block) => {
  if (!heartbeatKey) return { heartbeat: null }
  const e = await read(() => publicClient.getEntity(heartbeatKey)).catch(() => null)
  return { heartbeat: { key: heartbeatKey, alive: Boolean(e), expires_in_s: e ? Number(e.$expiresAt - block) * 2 : 0 } }
})


// POST /decision  {decision_id, kind, mode, og_request_id, model, og_storage_root, summary, day, arkiv_key?}
// A decision written with its 0G Storage root is sealed. One written without it (0G Storage was
// offline) stays patchable, and when the upload lands the Pi sends the saved arkiv_key: the bridge
// fills in og_storage_root, once. A root that is already there is never replaced.
route("POST", "/decision", async (b) => {
  const root = ogStorageRoot(b) ? String(ogStorageRoot(b)) : undefined
  if (b.arkiv_key) {
    if (!root) return { key: b.arkiv_key, patched: false }
    return write("decision root", async (tx) => {
      const current = await read(() => publicClient.getEntity(b.arkiv_key, Decision))
      if (current.$creator?.toLowerCase() !== account.address.toLowerCase()) throw Object.assign(new Error("not our decision"), { status: 409 })
      const have = current.og_storage_root?.value
      if (have === root) return { key: b.arkiv_key, patched: false }
      if (have) throw Object.assign(new Error(`decision already has og_storage_root ${have}`), { status: 409 })
      const r = await walletClient.patchEntity(Decision, b.arkiv_key, { set: { og_storage_root: root } }, tx)
      return { key: b.arkiv_key, txHash: r.txHash, patched: true }
    })
  }
  const values = {
    building: BUILDING,
    kind: String(b.kind),
    mode: String(b.mode),
    decision_id: u64(BigInt(b.decision_id)),
    day: String(b.day),
    ...(ogRequestId(b) ? { og_request_id: String(ogRequestId(b)).slice(0, 120) } : {}),
    ...(b.model ? { model: String(b.model).slice(0, 120) } : {}),
    ...(root ? { og_storage_root: root } : {}),
    summary: stringToBytes(String(b.summary || "")),
  }
  const opts = { expiration: days(30), ...(root ? { flags: SEALED } : {}) }
  const r = await write("decision", (tx) => walletClient.createEntity(Decision, values, opts, tx))
  return { key: r.entityKey, txHash: r.txHash, sealed: Boolean(root) }
})

// POST /daily  {day, panel_wh, flats_wh, solar_pct}: one entity per day, patched as the day goes on
const dailyKeys = new Map()

route("POST", "/daily", async (b) => {
  const day = String(b.day)
  const values = { panel_wh: d(b.panel_wh), flats_wh: d(b.flats_wh), solar_pct: d(b.solar_pct, 1) }
  return write("daily", async (tx) => {
    let k = dailyKeys.get(day)
    if (!k) {
      const found = await read(() =>
        ours(publicClient.select({ $key: true }).from(DailyOutput).where(and(eq("building", BUILDING), eq("day", day))))
          .limit(1)
          .fetch(),
      )
      k = found.entities[0]?.$key
    }
    if (k) {
      const r = await walletClient.patchEntity(DailyOutput, k, { set: values }, tx)
      dailyKeys.set(day, k)
      return { key: k, txHash: r.txHash, patched: true }
    }
    const r = await walletClient.createEntity(DailyOutput, { building: BUILDING, day, ...values }, { expiration: days(180) }, tx)
    dailyKeys.set(day, r.entityKey)
    return { key: r.entityKey, txHash: r.txHash, patched: false }
  })
})

// GET /history?days=7  -> the building's daily totals, newest first (read by Dyna's planner)
route("GET", "/history", async (_, url) => {
  const n = Math.min(Math.max(Number(url.searchParams.get("days") || 7), 1), 60)
  const page = await read(() =>
    ours(publicClient.select({ day: true, panel_wh: true, flats_wh: true, solar_pct: true }).from(DailyOutput).where(eq("building", BUILDING)))
      .orderBy(desc("day"))
      .limit(n)
      .fetch(),
  )
  return page.entities.map((e) => ({
    day: e.day.value,
    panel_wh: Number(e.panel_wh.value),
    flats_wh: Number(e.flats_wh.value),
    solar_pct: Number(e.solar_pct.value),
  }))
})

// POST /maintenance  {date, title, details, arc_tx?}
route("POST", "/maintenance", async (b) => {
  const values = {
    building: BUILDING,
    date: String(b.date || new Date().toISOString().slice(0, 10)),
    at: u64(BigInt(nowS())),
    title: String(b.title || "Maintenance").slice(0, 100),
    details: stringToBytes(String(b.details || "")),
    ...(b.arc_tx ? { arc_tx: String(b.arc_tx) } : {}),
  }
  const r = await write("maintenance", (tx) => walletClient.createEntity(Maintenance, values, { expiration: days(180), flags: SEALED }, tx))
  return { key: r.entityKey, txHash: r.txHash }
})

// POST /offer  {day, kwh, price_usdc, window_end (unix s), og_request_id}
// The offer expires exactly when the solar window closes: shops simply stop seeing it.
route("POST", "/offer", async (b) => {
  const windowEnd = Math.floor(Number(b.window_end))
  const values = {
    building: BUILDING,
    day: String(b.day),
    kwh: d(b.kwh, 3),
    price_usdc: d(b.price_usdc, 4),
    window_end: u64(BigInt(windowEnd)),
    ...(ogRequestId(b) ? { og_request_id: String(ogRequestId(b)).slice(0, 120) } : {}),
  }
  const r = await write("offer", (tx) => walletClient.createEntity(Offer, values, { expiration: until(windowEnd), flags: SEALED }, tx))
  return { key: r.entityKey, txHash: r.txHash, expiresAt: r.expiresAt }
})

// POST /cleaning_job  the Pi's cleaning Job, as is (cleaning flow v3, DECISIONS Fri 22:12):
//   { id, state, fee_usdc?, deadline?, created_at?, dusty_pct?, after_pct?,
//     og:  { request_id, tee, coverage_pct, input, storage_root },
//     arc: { job_id, open_tx, release_tx, refund_tx, proof_hash, proof_window: [from, to] },
//     arkiv_key? }                       -> { key, txHash, patched, extended }
// The first post creates the entity; the Pi keeps the returned key as job.arkiv_key and every later
// transition patches it (only the fields it sends). v2's flat {job_id, status, output_before, ...}
// still works. Lifetime follows the job: a flag nobody approves lapses after 48 h, an approved job
// lives until a week after its escrow deadline (time to dispute), a dispute keeps it 7 more days
// from then. Nothing ever shortens it.
const jobKeys = new Map() // case id (or "arc:<job_id>") -> entity key

async function findJob(cols) {
  const by = cols.case_id ? eq("case_id", cols.case_id) : cols.job_id ? eq("job_id", cols.job_id) : null
  if (!by) return null
  const page = await read(() => ours(publicClient.select({ $key: true }).from(CleaningJob).where(and(eq("building", BUILDING), by))).limit(1).fetch())
  return page.entities[0]?.$key ?? null
}

route("POST", "/cleaning_job", async (b) => {
  const cols = jobColumns(b)
  if (!cols.status) throw Object.assign(new Error("state (or status) is required"), { status: 400 })
  if (!cols.case_id && !cols.job_id && !b.arkiv_key) throw Object.assign(new Error("id, arc.job_id or arkiv_key is required"), { status: 400 })
  if (!JOB_STATES.includes(cols.status)) console.warn(`cleaning_job: unknown state "${cols.status}" written as is`)
  const cacheId = cols.case_id ?? `arc:${b.arc?.job_id ?? b.job_id}`
  const end = wantedEnd(cols.status, b.deadline)

  return write(`cleaning_job ${cacheId} ${cols.status}`, async (tx) => {
    let k = b.arkiv_key || jobKeys.get(cacheId) || (await findJob(cols))
    let current = null
    if (k) {
      current = await read(() => publicClient.getEntity(k)).catch((e) => (e?.name === "NoEntityFoundError" ? null : Promise.reject(e)))
      if (current && current.$creator?.toLowerCase() !== account.address.toLowerCase()) throw Object.assign(new Error("arkiv_key is not one of our jobs"), { status: 409 })
      if (!current) k = null // it lapsed (e.g. a flag left for 48 h): start a new record
    }

    if (k) {
      const { building, ...set } = cols // building never changes
      const head = await read(() => publicClient.getBlockNumber())
      const endBlock = end ? head + BigInt(Math.ceil((end - nowS()) / 2)) : 0n
      const extend = end && endBlock > current.$expiresAt + 30n // only ever lengthen, by more than a minute
      const r = await walletClient.executeBatch(
        {
          patches: [{ schema: CleaningJob, entityKey: k, set }],
          ...(extend ? { extensions: [{ entityKey: k, expiration: until(end) }] } : {}),
        },
        tx,
      )
      jobKeys.set(cacheId, k)
      return { key: k, txHash: r.txHash, patched: true, extended: Boolean(extend) }
    }

    const expiration = end ? until(end, ExpirationTime.fromHours(1)) : ExpirationTime.fromHours(48)
    const r = await walletClient.createEntity(CleaningJob, { building: BUILDING, ...cols }, { expiration }, tx)
    jobKeys.set(cacheId, r.entityKey)
    return { key: r.entityKey, txHash: r.txHash, patched: false, extended: false }
  }, { ops: 2 })
})

// POST /sale  {order_id, buyer, buyer_name?, kwh, usdc, arc_tx}: one settled ShopTrade order
route("POST", "/sale", async (b) => {
  const values = {
    building: BUILDING,
    order_id: u64(BigInt(b.order_id ?? 0)),
    buyer: addr(b.buyer),
    buyer_name: String(b.buyer_name || `Shop ${String(b.buyer).slice(0, 6)}…${String(b.buyer).slice(-4)}`).slice(0, 60),
    kwh: d(b.kwh, 3),
    usdc: d(b.usdc),
    arc_tx: String(b.arc_tx || ""),
  }
  const r = await write("sale", (tx) => walletClient.createEntity(Sale, values, { expiration: days(180), flags: SEALED }, tx))
  return { key: r.entityKey, txHash: r.txHash }
})

// POST /bill  {flat, month, kwh, solar_pct, usdc, arc_tx}: a monthly bill posted on Arc
route("POST", "/bill", async (b) => {
  const values = {
    building: BUILDING,
    flat: String(b.flat),
    month: String(b.month),
    kwh: d(b.kwh, 3),
    solar_pct: d(b.solar_pct, 1),
    usdc: d(b.usdc),
    ...(b.arc_tx ? { arc_tx: String(b.arc_tx) } : {}),
  }
  const r = await write("bill", (tx) => walletClient.createEntity(Bill, values, { expiration: days(180), flags: SEALED }, tx))
  return { key: r.entityKey, txHash: r.txHash }
})

// ---- keeper: the records worth keeping stay alive while the building runs ------------------
// Arkiv caps a lifetime at ~182 days, so the long-lived records (maintenance, bills, sales,
// daily totals) are extended to the maximum again once they get within 30 days of expiring.
// If the building stops paying for them, they lapse: storage has an owner and a cost.
const KEEP = [Maintenance, Bill, Sale, DailyOutput]
const KEEP_MARGIN_BLOCKS = BigInt(Number(process.env.ARKIV_KEEP_MARGIN_DAYS || 30)) * 24n * 1800n // days of 2 s blocks
let keeperLast = null

export async function runKeeper() {
  const head = await read(() => publicClient.getBlockNumber({ cacheTime: 0 }))
  let extended = 0
  for (const schema of KEEP) {
    const page = await read(() =>
      ours(publicClient.select({ $key: true }).from(schema).where(and(eq("building", BUILDING), lte("$expiresAt", u64(head + KEEP_MARGIN_BLOCKS)))))
        .limit(20)
        .fetch(),
    )
    if (!page.entities.length) continue
    const extensions = page.entities.map((e) => ({ entityKey: e.$key, expiration: ExpirationTime.max() }))
    await write(`keeper ${schema.name}`, (tx) => walletClient.executeBatch({ extensions }, tx), { ops: extensions.length })
    extended += extensions.length
  }
  keeperLast = { at: new Date().toISOString(), extended }
  return keeperLast
}

route("POST", "/keeper", () => runKeeper())
addHealth(async () => ({ keeper: keeperLast }))

const KEEPER_EVERY_MS = 6 * 3600 * 1000
setTimeout(() => runKeeper().catch((e) => console.warn("keeper failed:", redact(e?.shortMessage || e?.message))), 60_000)
setInterval(() => runKeeper().catch((e) => console.warn("keeper failed:", redact(e?.shortMessage || e?.message))), KEEPER_EVERY_MS).unref()
