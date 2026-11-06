// Every Dynaura record type on Arkiv. Each is a named schema, so every entity carries an
// indexed `arkiv.schema` tag ("dynaura.reading", ...) and queries only match our own kind.
// Readers must also filter .ownedBy(<building wallet>): anyone can write any tag.
// Copy of bridge/schemas.mjs (keep the two in sync).
import { addr, bool, bytes, dec, defineSchema, str, u64 } from "@arkiv-network/sdk/schema"

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

// A panel cleaning request, cleaning flow v3 (DECISIONS Fri 22:12). One entity per request, patched
// on every transition: flagged (0G saw dust) -> approved -> open (Arc escrow) -> accepted -> cleaned
// -> paid, or rejected / refunded / disputed -> resolved. no_check = 0G was unreachable, nothing
// flagged. Its life follows the job: an unapproved flag lapses after 48 h, an approved job lives
// until a week after the escrow deadline (time to dispute), a dispute adds 7 days from then.
// The lasting record is Maintenance.
// Every v3 column is optional so v2 jobs (Arc job_id + output_before/after) still read.
export const CleaningJob = defineSchema("dynaura.cleaning_job", {
  building: str().indexed(),
  case_id: str().indexed().optional(), // the Pi's job id: the request's identity from flag to payout
  status: str().indexed(), // flagged | approved | open | accepted | cleaned | paid | rejected | refunded | disputed | resolved | no_check
  job_id: u64().indexed().optional(), // CleaningEscrow job id on Arc, once approved
  created_at: u64().optional(), // unix s (sort key)
  fee_usdc: dec().optional(),
  deadline: u64().optional(), // unix s, escrow refund time
  dusty_pct: dec().optional(), // panel output vs expected when flagged
  after_pct: dec().optional(), // the same after cleaning, over the confirm window
  output_before: dec().optional(), // v2 name of dusty_pct
  output_after: dec().optional(), // v2 name of after_pct
  coverage_pct: dec().optional(), // 0G's dust coverage estimate
  og_input: str().optional(), // vision | meter-only
  og_tee: bool().optional(), // the 0G answer passed TEE verification
  og_request_id: str().indexed().optional(), // the 0G dust check (joins to dynaura.decision)
  og_storage_root: str().optional(), // its episode log on 0G Storage
  proof_hash: str().optional(), // sha256 of the signed readings window the release was paid on
  proof_from: u64().optional(), // that window: first and last minute (unix s) of the panel readings
  proof_to: u64().optional(),
  open_tx: str().optional(), // Arc: openJob
  release_tx: str().optional(), // Arc: release to the cleaner
  refund_tx: str().optional(), // Arc: refund to the society
  arc_tx: str().optional(), // the latest Arc tx (v2)
})

// A receipt for a paid cleaning, made by the building and handed to the cleaner's wallet in the same
// transaction. Two parties: the building CREATED it (provenance, fixed forever), the cleaner OWNS it
// (custody: the committee can't delete their work history). Sealed, so neither side can rewrite it;
// anyone may extend it, so it outlives the job board. Read with createdBy(building) + cleaner.
export const WorkReceipt = defineSchema("dynaura.work_receipt", {
  building: str().indexed(),
  cleaner: addr().indexed(),
  case_id: str().indexed().optional(), // the cleaning request (dynaura.cleaning_job case_id)
  job_id: u64().indexed().optional(), // CleaningEscrow job on Arc
  fee_usdc: dec(),
  paid_at: u64(), // unix s
  dusty_pct: dec().optional(),
  after_pct: dec().optional(),
  release_tx: str().optional(), // Arc: the payout
  og_request_id: str().optional(), // the 0G dust check
  proof_hash: str().optional(), // what the escrow released on
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

export const ALL = { Reading, Heartbeat, DailyOutput, Decision, Offer, Sale, CleaningJob, WorkReceipt, Maintenance, Bill }
