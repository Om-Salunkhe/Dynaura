# Dynaura on Arkiv: schema

All records are written by one **building wallet** through `bridge/bridge.mjs` on the Raspberry Pi
(Rabdi testnet, chain 7794095). Every schema is named, so each entity has an indexed `arkiv.schema`
tag. Readers always add `.ownedBy(<building wallet>)`, because anyone can write any tag.

Names, phone numbers and addresses are never stored. Flats are `A`, `B`, `C`.

| Schema (`arkiv.schema`) | One entity is | Indexed columns | Other columns | Lifetime (why) | Read by |
|---|---|---|---|---|---|
| `dynaura.reading` | 1-minute summary of one meter, signed by the Pi | `building`, `meter`, `minute` | `avg_w`, `wh`, `solar_wh`, `samples`, `signer`, `sig` | 7 days (raw use only matters for a week) | Live and History charts, Ask Dyna |
| `dynaura.heartbeat` | The building is online | `building`, `mode` | `flats`, `pump`, `solar_w`, `used_w`, `updated` | 2 min, extended every 30 s (expiry = "building offline") | App status badge |
| `dynaura.daily_output` | Daily totals | `building`, `day` | `panel_wh`, `flats_wh`, `solar_pct` | 180 days | **Dyna's planner prompt** (last 7 days), History |
| `dynaura.decision` | One 0G decision with its proof | `building`, `kind`, `mode`, `decision_id`, `day` | `request_id`, `model`, `storage_root`, `summary` | 30 days | History timeline, Ask Dyna |
| `dynaura.offer` | Spare kWh offered to nearby shops | `building`, `day` | `kwh`, `price_usdc`, `window_end`, `request_id` | Until the solar window ends (the market closes itself) | Shop offers page |
| `dynaura.sale` | kWh sold to a shop, paid on Arc | `building`, `buyer` | `buyer_name`, `kwh`, `usdc`, `arc_tx` | 180 days | Admin Trading page, shop receipt |
| `dynaura.cleaning_job` | Panel cleaning backed by Arc escrow | `building`, `job_id`, `status` | `fee_usdc`, `deadline`, `output_before`, `output_after`, `arc_tx` | Until the deadline (then the escrow refunds) | Cleaner job board |
| `dynaura.maintenance` | Maintenance visit on the solar asset | `building`, `date` | `title`, `details`, `arc_tx` | 180 days | Admin Upkeep page, Panel history |
| `dynaura.bill` | Monthly bill of one flat | `building`, `flat`, `month` | `kwh`, `solar_pct`, `usdc`, `arc_tx` | 180 days | Resident Bill page |

Arkiv caps one lifetime at about 182.5 days (7,884,000 blocks of 2 s); longer-lived records are
extended by the bridge.

Source of truth for the code: [`bridge/schemas.mjs`](../bridge/schemas.mjs).
