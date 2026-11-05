// The routes the Pi calls. Each one writes Arkiv entities owned by the building wallet.
import { ExpirationTime } from "@arkiv-network/sdk"
import { and, desc, eq } from "@arkiv-network/sdk/query"
import { addr, dec, u64 } from "@arkiv-network/sdk/schema"
import { hexToBytes, stringToBytes } from "viem"
import { account, BUILDING, publicClient, route, walletClient } from "./bridge.mjs"
import { Bill, CleaningJob, DailyOutput, Decision, Heartbeat, Maintenance, Offer, Reading, Sale } from "./schemas.mjs"

// Decimals as plain strings ("0.004167"), never scientific notation
export const d = (n, places = 6) => dec(Number(n || 0).toFixed(places).replace(/\.?0+$/, "") || "0")
export const days = (n) => ExpirationTime.fromDays(n)

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
  }))
  const r = await walletClient.executeBatch({ creates })
  return { created: r.createdEntities.length, txHash: r.txHash, keys: r.createdEntities }
})

// POST /heartbeat  {mode, flats: {A: "solar", ...}, pump: true, solar_w, used_w}
// One entity, patched and extended to "2 more minutes" each time. If the Pi stops, it expires
// and the app shows "Building offline": no cron job, no server, the expiry is the alarm.
let heartbeatKey = null

route("POST", "/heartbeat", async (b) => {
  const values = {
    mode: String(b.mode || "unknown"),
    flats: Object.entries(b.flats || {}).map(([f, s]) => `${f}:${s}`).join(","),
    pump: b.pump ? "on" : "off",
    solar_w: d(b.solar_w, 4),
    used_w: d(b.used_w, 4),
    updated: u64(BigInt(Math.floor(Date.now() / 1000))),
  }
  const ttl = ExpirationTime.fromMinutes(2)
  if (heartbeatKey) {
    try {
      const r = await walletClient.executeBatch({
        patches: [{ schema: Heartbeat, entityKey: heartbeatKey, set: values }],
        extensions: [{ entityKey: heartbeatKey, expiration: ttl }],
      })
      return { key: heartbeatKey, txHash: r.txHash, renewed: true }
    } catch (e) {
      console.warn("heartbeat renew failed, creating a new one:", e?.shortMessage || e?.message)
      heartbeatKey = null // expired (Pi was off > 2 min) or never existed: start a new one
    }
  }
  const { entityKey, txHash } = await walletClient.createEntity(
    Heartbeat,
    { building: BUILDING, ...values },
    { expiration: ttl },
  )
  heartbeatKey = entityKey
  return { key: entityKey, txHash, renewed: false }
})

// POST /decision  {decision_id, kind, mode, request_id, model, storage_root, summary, day, arkiv_key?}
// With arkiv_key the decision is already on Arkiv (written before its 0G Storage upload worked,
// e.g. while 0G was offline): only the root that came later is patched in.
route("POST", "/decision", async (b) => {
  if (b.arkiv_key) {
    if (!b.storage_root) return { key: b.arkiv_key, patched: false }
    const { txHash } = await walletClient.patchEntity(Decision, b.arkiv_key, {
      set: { storage_root: String(b.storage_root) },
    })
    return { key: b.arkiv_key, txHash, patched: true }
  }
  const { entityKey, txHash } = await walletClient.createEntity(
    Decision,
    {
      building: BUILDING,
      kind: String(b.kind),
      mode: String(b.mode),
      decision_id: u64(BigInt(b.decision_id)),
      day: String(b.day),
      ...(b.request_id ? { request_id: String(b.request_id).slice(0, 120) } : {}),
      ...(b.model ? { model: String(b.model).slice(0, 120) } : {}),
      ...(b.storage_root ? { storage_root: String(b.storage_root) } : {}),
      summary: stringToBytes(String(b.summary || "")),
    },
    { expiration: days(30) },
  )
  return { key: entityKey, txHash }
})

// POST /daily  {day, panel_wh, flats_wh, solar_pct}: one entity per day, patched as the day goes on
const dailyKeys = new Map()

route("POST", "/daily", async (b) => {
  const values = { panel_wh: d(b.panel_wh), flats_wh: d(b.flats_wh), solar_pct: d(b.solar_pct, 1) }
  let k = dailyKeys.get(b.day)
  if (!k) {
    const found = await publicClient
      .select({ $key: true })
      .from(DailyOutput)
      .where(and(eq("building", BUILDING), eq("day", String(b.day))))
      .ownedBy(account.address)
      .limit(1)
      .fetch()
    k = found.entities[0]?.$key
  }
  if (k) {
    const r = await walletClient.patchEntity(DailyOutput, k, { set: values })
    dailyKeys.set(b.day, k)
    return { key: k, txHash: r.txHash, patched: true }
  }
  const { entityKey, txHash } = await walletClient.createEntity(
    DailyOutput,
    { building: BUILDING, day: String(b.day), ...values },
    { expiration: days(180) },
  )
  dailyKeys.set(b.day, entityKey)
  return { key: entityKey, txHash, patched: false }
})

// GET /history?days=7  -> the building's daily totals, newest first (read by Dyna's planner)
route("GET", "/history", async (_, url) => {
  const n = Math.min(Number(url.searchParams.get("days") || 7), 60)
  const page = await publicClient
    .select({ day: true, panel_wh: true, flats_wh: true, solar_pct: true })
    .from(DailyOutput)
    .where(eq("building", BUILDING))
    .ownedBy(account.address)
    .orderBy(desc("day"))
    .limit(n)
    .fetch()
  return page.entities.map((e) => ({
    day: e.day.value,
    panel_wh: Number(e.panel_wh.value),
    flats_wh: Number(e.flats_wh.value),
    solar_pct: Number(e.solar_pct.value),
  }))
})

// POST /maintenance  {date, title, details, arc_tx?}
route("POST", "/maintenance", async (b) => {
  const { entityKey, txHash } = await walletClient.createEntity(
    Maintenance,
    {
      building: BUILDING,
      date: String(b.date || new Date().toISOString().slice(0, 10)),
      title: String(b.title || "Maintenance").slice(0, 100),
      details: stringToBytes(String(b.details || "")),
      ...(b.arc_tx ? { arc_tx: String(b.arc_tx) } : {}),
    },
    { expiration: days(180) },
  )
  return { key: entityKey, txHash }
})

// POST /offer  {day, kwh, price_usdc, window_end (unix s), request_id}
// The offer expires when the solar window closes: shops simply stop seeing it.
route("POST", "/offer", async (b) => {
  const secondsLeft = Math.max(120, Number(b.window_end) - Math.floor(Date.now() / 1000))
  const { entityKey, txHash } = await walletClient.createEntity(
    Offer,
    {
      building: BUILDING,
      day: String(b.day),
      kwh: d(b.kwh, 3),
      price_usdc: d(b.price_usdc, 4),
      window_end: u64(BigInt(Math.floor(Number(b.window_end)))),
      ...(b.request_id ? { request_id: String(b.request_id).slice(0, 120) } : {}),
    },
    { expiration: ExpirationTime.fromMinutes(Math.ceil(secondsLeft / 60)) },
  )
  return { key: entityKey, txHash }
})

// POST /cleaning_job  {job_id, status, fee_usdc, deadline, output_before, output_after?, arc_tx?}
// Created when the escrow opens, patched as it is accepted / paid / refunded.
// Lives until a day after the deadline; the lasting record is the Maintenance entry.
const jobKeys = new Map()

route("POST", "/cleaning_job", async (b) => {
  const set = {
    status: String(b.status),
    ...(b.output_after != null ? { output_after: d(b.output_after, 1) } : {}),
    ...(b.arc_tx ? { arc_tx: String(b.arc_tx) } : {}),
  }
  let k = jobKeys.get(String(b.job_id))
  if (!k) {
    try {
      const found = await publicClient
        .select({ $key: true })
        .from(CleaningJob)
        .where(and(eq("building", BUILDING), eq("job_id", u64(BigInt(b.job_id)))))
        .ownedBy(account.address)
        .limit(1)
        .fetch()
      k = found.entities[0]?.$key
    } catch (e) {
      console.warn("cleaning job lookup failed, creating a new one:", e?.shortMessage || e?.message)
    }
  }
  if (k) {
    const r = await walletClient.patchEntity(CleaningJob, k, { set })
    jobKeys.set(String(b.job_id), k)
    return { key: k, txHash: r.txHash, patched: true }
  }
  const secondsLeft = Math.max(0, Number(b.deadline) - Math.floor(Date.now() / 1000))
  const { entityKey, txHash } = await walletClient.createEntity(
    CleaningJob,
    {
      building: BUILDING,
      job_id: u64(BigInt(b.job_id)),
      fee_usdc: d(b.fee_usdc),
      deadline: u64(BigInt(Math.floor(Number(b.deadline)))),
      output_before: d(b.output_before, 1),
      ...set,
    },
    { expiration: ExpirationTime.fromMinutes(Math.ceil(secondsLeft / 60) + 24 * 60) },
  )
  jobKeys.set(String(b.job_id), entityKey)
  return { key: entityKey, txHash, patched: false }
})

// POST /sale  {order_id, buyer, kwh, usdc, arc_tx}: one settled ShopTrade order
route("POST", "/sale", async (b) => {
  const { entityKey, txHash } = await walletClient.createEntity(
    Sale,
    {
      building: BUILDING,
      buyer: addr(b.buyer),
      buyer_name: String(b.buyer_name || `Shop ${String(b.buyer).slice(0, 6)}…${String(b.buyer).slice(-4)}`),
      kwh: d(b.kwh, 3),
      usdc: d(b.usdc),
      arc_tx: String(b.arc_tx || ""),
    },
    { expiration: days(180) },
  )
  return { key: entityKey, txHash }
})

// POST /bill  {flat, month, kwh, solar_pct, usdc, arc_tx}: a monthly bill posted on Arc
route("POST", "/bill", async (b) => {
  const { entityKey, txHash } = await walletClient.createEntity(
    Bill,
    {
      building: BUILDING,
      flat: String(b.flat),
      month: String(b.month),
      kwh: d(b.kwh, 3),
      solar_pct: d(b.solar_pct, 1),
      usdc: d(b.usdc),
      ...(b.arc_tx ? { arc_tx: String(b.arc_tx) } : {}),
    },
    { expiration: days(180) },
  )
  return { key: entityKey, txHash }
})
