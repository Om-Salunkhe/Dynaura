// The routes the Pi calls. Each one writes Arkiv entities owned by the building wallet.
import { ExpirationTime } from "@arkiv-network/sdk"
import { addr, dec, u64 } from "@arkiv-network/sdk/schema"
import { hexToBytes } from "viem"
import { BUILDING, route, walletClient } from "./bridge.mjs"
import { Reading } from "./schemas.mjs"

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
