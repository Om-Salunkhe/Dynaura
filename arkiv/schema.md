# Dynaura on Arkiv: schema

Network: **Rabdi** testnet (chain 7794095, gas in tGLM). SDK: `@arkiv-network/sdk` 1.0.1.
Code: [`bridge/schemas.mjs`](../bridge/schemas.mjs) is the source of truth. The web app reads
through an identical copy in [`web/src/lib/arkivSchemas.js`](../web/src/lib/arkivSchemas.js).

## Rules for every record

- **One writer.** The building wallet writes every entity, through `bridge/` on the Raspberry Pi.
  Writes go through one queue, one transaction at a time ([how](how-you-use-arkiv.md#the-write-path)).
- **Named schemas.** Each entity carries an indexed `arkiv.schema` tag (`dynaura.decision`, ...),
  plus an indexed `building` id, so one wallet could serve several buildings.
- **Readers trust creator and owner, not tags.** Anyone can write an entity with our tags, and an
  owner can hand an entity to any address. So every read requires
  `.createdBy(<building wallet>).ownedBy(<building wallet>)`. The creator can never change.
- **No personal data.** There are no names, phone numbers or addresses. Flats are `A`, `B` and `C`.
  The only addresses stored are the Pi's device key (`signer`) and the shop wallets that paid on
  Arc (`buyer`).
- **Facts are sealed.** Records that state a fact (a reading, an offer, a sale, a bill, a
  maintenance visit, and a decision once its proof is complete) are created with
  `flags: { readonly: true }`. Arkiv refuses any change to their contents, even from the building
  wallet. Only their expiry can be extended.
- **0G proof fields** are named `og_request_id` and `og_storage_root` on every record that carries
  them (team decision, 01:30). The bridge still accepts the old `request_id` / `storage_root` from
  older Pi code.
- **Every entity has an end.** Each lifetime below is a product decision, not a default.

## Schemas

| Schema (`arkiv.schema`) | One entity is | Indexed (filterable) | Other columns | Lifetime, and why | Can it change? | Read by |
|---|---|---|---|---|---|---|
| `dynaura.reading` | 1-minute summary of one meter, **signed by the Pi's device key** | `building`, `meter` (panel/A/B/C), `minute` (unix s) | `avg_w`, `wh`, `solar_wh`, `samples`, `signer`, `sig` | **7 days.** Minute-level use of a home is personal; after a week only daily totals remain | **Sealed** (readonly) | Proof behind each cleaning payout; History charts |
| `dynaura.heartbeat` | "The building is online" | `building`, `mode` | `flats`, `pump`, `solar_w`, `used_w`, `updated` | **2 minutes**, renewed every 30 s. **If it expires, the app shows "Building offline"** | Patched + extended every 30 s, in one transaction | Admin "Building online" badge |
| `dynaura.daily_output` | One day's totals | `building`, `day` (YYYY-MM-DD) | `panel_wh`, `flats_wh`, `solar_pct` | **180 days**, kept alive by the keeper | Patched every 10 min during the day | **Dyna's planner prompt** (last 7 days), History |
| `dynaura.decision` | One 0G decision and its proof | `building`, `kind` (plan/ask/cleaning), `mode` (ai, no-ai, or meter for escrow steps), `decision_id`, `day`, `og_request_id` (0G Router request ID) | `model`, `og_storage_root` (0G Storage root of the episode), `summary` (bytes, UTF-8) | **30 days.** The full episode stays on 0G Storage | **Sealed** when written with its root. If 0G Storage was offline, the root is **patched in once** when the upload lands; a different root is refused | History timeline, Home "Recent on Arkiv", Ask Dyna, a cleaning job's proof chip |
| `dynaura.offer` | Spare solar offered to nearby shops | `building`, `day` | `kwh`, `price_usdc`, `window_end`, `og_request_id` (the 0G plan that found the spare solar) | **Until `window_end`** (the solar window). **The market closes itself** | **Sealed** (readonly) | Shop offers page |
| `dynaura.sale` | kWh sold to a shop and settled on Arc | `building`, `order_id` (ShopTrade), `buyer` (shop wallet) | `buyer_name`, `kwh`, `usdc`, `arc_tx` | **180 days**, kept alive by the keeper | **Sealed** (readonly) | Admin trading page, shop receipt |
| `dynaura.cleaning_job` | Panel cleaning backed by an Arc escrow | `building`, `job_id` (CleaningEscrow), `status` (open/accepted/paid/refunded), `og_request_id` (the 0G dust check) | `fee_usdc`, `deadline`, `output_before`, `output_after`, `arc_tx`, `og_storage_root` (patched in when the upload lands) | **Until the escrow deadline + 1 day.** The job board clears itself; the lasting record is a `maintenance` entry | Patched as the escrow moves: open → accepted → paid or refunded | Cleaner job board |
| `dynaura.maintenance` | Maintenance visit on the solar asset | `building`, `date` | `at` (unix s, sort key), `title`, `details` (bytes), `arc_tx` | **180 days**, kept alive by the keeper | **Sealed** (readonly) | Admin upkeep page, History |
| `dynaura.bill` | One flat's monthly bill, paid on Arc | `building`, `flat`, `month` (YYYY-MM) | `kwh`, `solar_pct`, `usdc`, `arc_tx` | **180 days**, kept alive by the keeper | **Sealed** (readonly) | Resident Bill page |

`str` values are capped at 128 bytes, so long text (`decision.summary`, `maintenance.details`)
goes in `bytes` columns. Those can't be filtered or sorted, which we don't need for them.

## How the records link to 0G and Arc

```
dynaura.decision.og_request_id      -> the 0G Compute request that made the decision (TEE-verified)
dynaura.decision.og_storage_root    -> the full episode log on 0G Storage
dynaura.cleaning_job.og_request_id  -> the 0G dust check behind the job; indexed, so the job finds
                                       its decision with one query (og_request_id = …)
dynaura.cleaning_job.og_storage_root-> that check's episode log (also linked on Arc: linkEpisode)
dynaura.cleaning_job.job_id         -> CleaningEscrow job on Arc; arc_tx = open / release / refund tx
dynaura.sale.order_id         -> ShopTrade order on Arc;     arc_tx = settlement tx
dynaura.bill.arc_tx           -> SolarBilling tx on Arc
dynaura.reading.sig           -> signature by the Pi's device key over the summary; anyone can verify
                                 it, and the escrow's release proof is sha256 of the last 3 signed
                                 panel summaries
```

## Lifetimes and the keeper

Arkiv caps one lifetime at 7,884,000 blocks: about 182.5 days of 2-second blocks. Records worth
keeping (`maintenance`, `bill`, `sale`, `daily_output`) are created with 180 days. Every 6 hours
the bridge's keeper queries those that expire within 30 days and extends them to
`ExpirationTime.max()`. The query is `lte("$expiresAt", head + 30 days)`, scoped to the building
wallet. So they live as long as the building keeps running and paying for them, and lapse if it
stops.

Patches never move an entity's expiry; we checked this live. The heartbeat therefore renews with a
patch and an extension in one atomic batch.

## Wallets

| Wallet | Address | Writes |
|---|---|---|
| Building wallet (demo, `sunrise-apartments`) | **TODO: the address from the Pi bridge's `/health`** | Every demo record |
| Test wallet (`test-dyarkiv-1`) | [`0xd961a5C42dd84F003Ef3C85a1bD08BE59A8717Cd`](https://rabdi.explorer.arkiv.network/address/0xd961a5C42dd84F003Ef3C85a1bD08BE59A8717Cd) | Live smoke tests of every schema |
