// The routes the Pi calls. Each one writes Arkiv entities owned by the building wallet.
import { ExpirationTime } from "@arkiv-network/sdk"
import { addr, dec, u64 } from "@arkiv-network/sdk/schema"
import { hexToBytes } from "viem"
import { BUILDING, route, walletClient } from "./bridge.mjs"
import { Heartbeat, Reading } from "./schemas.mjs"

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
