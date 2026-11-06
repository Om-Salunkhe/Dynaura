// Every Dynaura record type on Arkiv. Each is a named schema, so every entity carries an
// indexed `arkiv.schema` tag ("dynaura.reading", ...) and queries only match our own kind.
// Readers must also filter .ownedBy(<building wallet>): anyone can write any tag.
// The web app keeps a copy of this file in web/src/lib/arkivSchemas.js.
import { addr, bytes, dec, defineSchema, str, u64 } from "@arkiv-network/sdk/schema"

// 1-minute summary per meter, signed by the Pi's device key. Lives 7 days.
export const Reading = defineSchema("dynaura.reading", {
  building: str().indexed(),
  meter: str().indexed(), // panel | A | B | C
  minute: u64().indexed(), // unix seconds of the minute start
  avg_w: dec(),
  wh: dec(),
  solar_wh: dec(),
  samples: u64(),
  signer: addr(),
  sig: bytes(),
})

// The building is alive. Patched every 30 s, expires 2 min after the last one: expiry = offline alarm.
export const Heartbeat = defineSchema("dynaura.heartbeat", {
  building: str().indexed(),
  mode: str().indexed(), // plan | no-ai | no-plan | safe-stop
  flats: str(), // "A:solar,B:grid,C:solar"
  pump: str(), // on | off
  solar_w: dec(),
  used_w: dec(),
  updated: u64(),
})

// Daily totals per building. Read by Dyna's planner (last 7 days). Lives ~6 months (extend).
export const DailyOutput = defineSchema("dynaura.daily_output", {
  building: str().indexed(),
  day: str().indexed(), // YYYY-MM-DD
  panel_wh: dec(),
  flats_wh: dec(),
  solar_pct: dec(),
})

// Every 0G decision (plan, ask, cleaning) with its proof. Lives 30 days. Sealed when it is written
// with its 0G Storage root; if the upload came later (0G offline), the root is patched in once.
export const Decision = defineSchema("dynaura.decision", {
  building: str().indexed(),
  kind: str().indexed(), // plan | ask | cleaning
  mode: str().indexed(), // ai | no-ai | meter
  decision_id: u64().indexed(),
  day: str().indexed(),
  og_request_id: str().indexed().optional(), // 0G Router request ID (ZG-Res-Key): joins jobs to decisions
  model: str().optional(),
  og_storage_root: str().optional(), // 0x bytes32: 0G Storage root of the full episode log
  summary: bytes(), // UTF-8, can be longer than 128 bytes
})

// Spare solar offered to nearby shops. Expires when the solar window closes: the market closes itself.
export const Offer = defineSchema("dynaura.offer", {
  building: str().indexed(),
  day: str().indexed(),
  kwh: dec(),
  price_usdc: dec(), // per kWh
  window_end: u64(), // unix seconds
  og_request_id: str().optional(), // the 0G plan that found the spare solar
})

// A sale to a shop, settled on Arc. Lives ~6 months.
export const Sale = defineSchema("dynaura.sale", {
  building: str().indexed(),
  order_id: u64().indexed(), // id in the ShopTrade contract
  buyer: addr().indexed(),
  buyer_name: str(),
  kwh: dec(),
  usdc: dec(),
  arc_tx: str(),
})

// Panel cleaning job backed by an Arc escrow. Expires at the deadline (refund time).
export const CleaningJob = defineSchema("dynaura.cleaning_job", {
  building: str().indexed(),
  job_id: u64().indexed(), // id in the CleaningEscrow contract
  status: str().indexed(), // open | accepted | paid | refunded
  fee_usdc: dec(),
  deadline: u64(),
  output_before: dec(), // % of expected output when posted
  output_after: dec().optional(),
  arc_tx: str().optional(),
  og_request_id: str().indexed().optional(), // the 0G dust check behind the job (DECISIONS 01:30)
  og_storage_root: str().optional(), // its episode log on 0G Storage, patched in when the upload lands
})

// Maintenance history of the solar asset. Lives ~6 months (extend).
export const Maintenance = defineSchema("dynaura.maintenance", {
  building: str().indexed(),
  date: str().indexed(), // YYYY-MM-DD
  at: u64().optional(), // unix seconds: orders several visits on one day (sortable, not indexed)
  title: str(),
  details: bytes(),
  arc_tx: str().optional(),
})

// Monthly bill per flat, paid on Arc. Lives ~6 months.
export const Bill = defineSchema("dynaura.bill", {
  building: str().indexed(),
  flat: str().indexed(),
  month: str().indexed(), // YYYY-MM
  kwh: dec(),
  solar_pct: dec(),
  usdc: dec(),
  arc_tx: str().optional(),
})

export const ALL = { Reading, Heartbeat, DailyOutput, Decision, Offer, Sale, CleaningJob, Maintenance, Bill }
