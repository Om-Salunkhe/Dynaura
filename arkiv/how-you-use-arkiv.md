# How Dynaura uses Arkiv

```
 Raspberry Pi (the building)                          Arkiv (Rabdi testnet)              Anyone
 ┌───────────────────────────────┐   POST JSON   ┌─────────────────┐  one tx  ┌──────────────────┐  query  ┌───────────────────────┐
 │ meters, relays, 0G planner,   │ ────────────> │ bridge/ (Node)  │ ───────> │ 9 named schemas, │ <────── │ web app (browser, no  │
 │ Arc escrow watcher            │ 127.0.0.1:5100│ single writer   │          │ typed + indexed, │         │ server), curl, judges │
 │ signs every 1-min reading     │ <──────────── │ building wallet │          │ every one expires│         └───────────────────────┘
 └───────────────────────────────┘  7-day history└─────────────────┘          └──────────────────┘
          ^ Dyna's planner reads its own last 7 days back from Arkiv
```

- **Writes:** only the Pi, through [`bridge/`](../bridge), signed by the **building wallet**.
- **Reads:** the web app queries Arkiv **directly from the browser**
  ([`web/src/lib/arkivReads.js`](../web/src/lib/arkivReads.js)). There is no Dynaura API in
  between, so what a resident sees is what anyone can check. The AI planner reads its history from
  Arkiv too (`GET /history` on the bridge).
- **Schemas:** [schema.md](schema.md).

## Screens ↔ queries

Every screen that shows Arkiv data runs one of these queries, scoped to entities the building
wallet **created and still owns** (`.createdBy(w).ownedBy(w)`; see [Trust](#trust-and-edit-rights)).
"Indexed filter" means a node-side predicate on an indexed column. Sorting needs no index.

| Who / screen | Schema | Indexed filter | Order, limit | Why this shape | In the app now |
|---|---|---|---|---|---|
| **Dyna's planner prompt** (Pi, via bridge `GET /history`) | `dynaura.daily_output` | `building = …` | `day` desc, 7 | The AI plans tomorrow from the building's own last week, read back from the open record | Yes (Pi) |
| **Admin: "Building online"** badge | `dynaura.heartbeat` | `building = …` | `updated` desc, 1 | **No row means offline**: the heartbeat expired because the Pi stopped renewing it | Yes |
| **History** timeline, **Home** "Recent on Arkiv" | `dynaura.decision` | `building = …` | `decision_id` desc, 15 | Each row links its 0G request ID and 0G Storage root | Yes |
| **History**, **Admin upkeep** | `dynaura.maintenance` | `building = …` | `at` desc, 10–20 | `at` is an unindexed sort key (see friction #6) | Yes |
| **Shop offers** | `dynaura.offer` | `building = …` | `window_end` asc, 20 | Expired offers are not returned: **the market closed itself** | Yes |
| **Cleaner job board** | `dynaura.cleaning_job` | `building = …` **and `status = open`** (or accepted/paid) | `job_id` desc, 20 | The status column is indexed so the board is one query | Read ready (`fetchCleaningJobs`); **TODO** wire the screen |
| **Job → its 0G decision** (proof chip on a job) | `dynaura.decision` | `building = …` **and `og_request_id = <the job's og_request_id>`** | 1 | Joins Arc escrow → Arkiv job → 0G decision with one indexed lookup | Read ready (`fetchDecisionByOgRequest`) |
| **Resident Bill** | `dynaura.bill` | `building = …` **and `flat = A`** (or `month = 2026-11`) | `month` desc, 12 | A flat sees its own bills; the committee filters by month | Read ready (`fetchBills`); **TODO** wire the screen |
| **Admin trading**, shop receipt | `dynaura.sale` | `building = …` (and `buyer = <shop wallet>`) | `order_id` desc, 20 | A shop can find its own receipts by wallet | Read ready (`fetchSales`); **TODO** wire the screen |
| **Panel proof** (escrow release) | `dynaura.reading` | `building`, **`meter = panel`**, **`minute >= t`** | `minute` desc, 60 | The release proof hashes the last 3 signed panel readings, which anyone can re-fetch and verify | Read ready (`fetchReadings`) |
| **Bridge internals** | `daily_output`, `cleaning_job`, `heartbeat` | `day = …` / `job_id = …` | 1 | Find today's totals or a job's entity to patch it; recover the live heartbeat after a restart | Yes (bridge) |
| **Keeper** (every 6 h) | maintenance, bill, sale, daily_output | **`$expiresAt <= head + 30 days`** | 20 | Extend records worth keeping before they lapse | Yes (bridge) |

The same queries run in our live smoke test
([`bridge/smoke.mjs`](../bridge/smoke.mjs), 36/36 checks), so what we test is what the screens show.

## Reads from the browser, and the access key

The web app reads Arkiv **without an access key**. `rabdi()` puts a key in the RPC URL, so a key
in the bundle is public. Arkiv's security guidance keeps operator keys server-side; only the bridge
on the Pi has ours. The app reads the public endpoint with jittered backoff
([`arkivReads.js`](../web/src/lib/arkivReads.js)), and prints errors only after redacting them.

We checked that this is enough. The web app's own five queries (decisions, maintenance, heartbeat,
offers, open jobs) were fired together as one "page load" against the keyless endpoint from one
machine, 6 Nov 2026:

| Load | Queries | Succeeded | 429s | Page load p50 / p95 |
|---|---|---|---|---|
| 20 page loads, 3 s apart | 100 | **100%** | 0 | 953 ms / 4.4 s (slow spell on the RPC) |
| 30 page loads back to back (~13 queries/s) | 150 | **100%** | 0 | 340 ms / 565 ms |
| 4 viewers at once, 25 loads each (~40 queries/s, one IP) | 500 | **100%** | 0 | 425–461 ms / 599–887 ms |

The app's real load is 1–3 queries per screen, plus one heartbeat query every 30 s on the admin
screen: far below what we tested. If the venue's shared IP ever gets rate limited, the fix is a
**separate** key made only for the public app, origin-restricted and revocable. It would never be
the bridge's key.

## Trust and edit rights

| Who | Can | How it's enforced |
|---|---|---|
| **Building wallet** (on the Pi) | Create every record. Patch only heartbeat, daily totals, cleaning jobs. Extend lifetimes. | The bridge is the only process with the key; it listens on 127.0.0.1 only |
| **Building wallet** | **Not** change a bill, sale, reading, offer, maintenance entry, or a decision with its proof, after it is written | Created with `flags: { readonly: true }`. Arkiv itself refuses the change |
| **Building wallet** | Add a missing 0G root to a decision **once** (0G Storage was offline when it was written) | The bridge patches only `og_storage_root`, only if the decision has none, and refuses a different one (`409`) |
| **Anyone else** | Write entities with our schema tags, even hand them to our wallet | Every read requires `$creator = w AND $owner = w`. [`trust-check.mjs`](../bridge/trust-check.mjs) proves it live: a stranger's fake "pay the cleaner twice" decision, transferred to our wallet, shows up under `.ownedBy()` alone and not under ours |
| **The Pi's device key** (separate from the wallet) | Sign each 1-minute meter summary | `sig` + `signer` stored on every reading; anyone can recover the signer |

## Expiry as product logic

| Record | Expiration we set | What happens when it expires |
|---|---|---|
| Heartbeat | `fromMinutes(2)`, renewed every 30 s with **patch + extend in one atomic batch** | App shows "Building offline". No monitoring server |
| Offer | `atDate(window_end)` with an `atLeast` of 2 min | Shops stop seeing it at sunset |
| Cleaning job | `atDate(deadline + 1 day)` | Off the job board after the escrow refunds |
| Reading | `fromDays(7)` | Minute-level household data is gone after a week |
| Decision | `fromDays(30)` | The full episode stays on 0G Storage |
| Maintenance, bill, sale, daily totals | `fromDays(180)`, then the keeper extends them to `max()` | They live while the building runs, and lapse if it stops paying |

**Checked live:** a patch does **not** move the expiry. A `daily_output` and a `cleaning_job`,
patched twice, kept their exact `$expiresAt` block. That's why the heartbeat's renewal is a patch
**and** an extension, and why our cleaning-job patches don't cut its life short.

## The write path

Arkiv writes are transactions, and an exception doesn't tell you whether one landed
([friction #8](friction.md)). [`bridge/writer.mjs`](../bridge/writer.mjs) follows Arkiv's
`arkiv-write-safety` guidance:

1. **One queue, one transaction at a time.** Two writes in flight would pick the same nonce. This
   was a real bug: an admin action posting while the Pi's queue posted. The queue is bounded
   (`503` when full) and a waiting heartbeat is replaced by a newer one.
2. **Explicit nonce, gas and gas price** on every write. Gas is 1M + 400k per extra operation,
   because the SDK's own estimate ran out of gas live ([friction #1](friction.md)).
3. **Reconcile, never resend blindly.**
   - Known hash: the receipt decides.
   - No hash but the nonce was used: find the transaction by sender + nonce.
   - Nonce unused: retry once **on the same nonce**, so at most one copy can land.
   - Out of gas: exactly one retry with double gas.
   - Anything else: marked "uncertain" in `/health` and never resent.
4. **Batches where they are atomic.** One reading batch per minute (4 meters, 1 transaction);
   heartbeat patch + extend in 1 transaction.
5. **Reads back off** with jittered exponential delay on 429/5xx.

`GET /health` on the bridge shows the queue, in-flight write, counts, uncertain writes, balance,
the heartbeat's remaining life and the keeper's last run. Eleven offline tests
([`writer.test.mjs`](../bridge/writer.test.mjs)) cover the failure paths.

## Live transactions

From the smoke test run on 6 Nov 2026 against the test building `test-dyarkiv-1` (test wallet
[`0xd961…17Cd`](https://rabdi.explorer.arkiv.network/address/0xd961a5C42dd84F003Ef3C85a1bD08BE59A8717Cd)).
This is the hero moment's Arkiv trail in order:

| Step | What Arkiv records | Transaction |
|---|---|---|
| Meters (every minute) | 4 signed readings in one sealed batch | [`0xc4300c83…`](https://rabdi.explorer.arkiv.network/tx/0xc4300c83655737bf7433e5c19b45bb289b56005439ae558c6fd8ff68558583ae) |
| Building online | Heartbeat patch + extend, one tx | [`0xa877ed1c…`](https://rabdi.explorer.arkiv.network/tx/0xa877ed1c5c037e495ce60a6f21130f517abd100e75f16de9b9d763a71260a369) |
| Dyna plans (0G) | Decision with `og_request_id` + `og_storage_root`, sealed | [`0x9253662a…`](https://rabdi.explorer.arkiv.network/tx/0x9253662a3db82af30c4ab6555cec9cffa22a78e71463f7f9fef1035aed7f9d2d) |
| Spare solar for shops | Offer, expires at the window end | [`0x04d951d9…`](https://rabdi.explorer.arkiv.network/tx/0x04d951d99918adee71710db3714d81028ffbde46d412cf535c064956ef32444c) |
| 0G dust check (0G Storage offline) | Decision written **without** its root, left patchable | [`0xed36f607…`](https://rabdi.explorer.arkiv.network/tx/0xed36f607c789b4b2cd3f428d0b9461eccaad47a86aef10119c4c5c4338216312) |
| Upload lands | Root patched in **once** (a second, different root was refused) | [`0x6bddae51…`](https://rabdi.explorer.arkiv.network/tx/0x6bddae51c14d23b85fbfa26c640a0f8e0ef1cebdf67f0e7737ddcf69a7c6d04a) |
| Panel dirty → escrow opens (Arc) | Cleaning job `open`, output 52%, `og_request_id` of the dust check | [`0xcd706d9b…`](https://rabdi.explorer.arkiv.network/tx/0xcd706d9bb492f80a09555b2a0bb67f89789f2faa45b677e412f73b19cbbd10af) |
| Cleaner accepts | Patch `status = accepted` | [`0xde55acb4…`](https://rabdi.explorer.arkiv.network/tx/0xde55acb47a8af99dbacc9dcacc590cbcea19378b615ca9d403ddc1866c20ccbe) |
| Meter sees 94% → USDC released | Patch `status = paid`, `output_after = 94.1`, `og_storage_root` | [`0xa1ba4b3b…`](https://rabdi.explorer.arkiv.network/tx/0xa1ba4b3b3fd28a5c7d1f8ee045f5e68471c9e97231d0b744f0e420364c12ea38) |
| Lasting record | Maintenance entry, sealed | [`0x9478663a…`](https://rabdi.explorer.arkiv.network/tx/0x9478663a5b2ebae1126e0914f9f1597fef37669b8f77681205d5d95c8c044300) |
| Shop pays on Arc | Sale, sealed | [`0x464a2344…`](https://rabdi.explorer.arkiv.network/tx/0x464a234407b0e374e4a18c2f4f316dce919708c61282f588b4d3a2586176ddc0) |
| Month end | Bill for flat A, sealed | [`0x15620473…`](https://rabdi.explorer.arkiv.network/tx/0x15620473aa9ba19438426417fda40217d76093bdc305374940b4735edbe7b10c) |

**TODO (Pawan/Om):** add the same trail from the live demo on `sunrise-apartments`, from the Pi's
bridge, once it has run.

## Measured

Live on Rabdi, 6 Nov 2026, from Mumbai, with an access key:

| | Value |
|---|---|
| Write, end to end (POST to the bridge → receipt) | **3.4–4.0 s** average over 15 writes per run (fastest 1.8 s) |
| Read (the web's queries) | **0.36–0.65 s** average over 9 queries |
| Gas per write | heartbeat renewal 73k · daily patch 43k · cleaning-job patch 50–59k · offer 128k · decision 219k · bill/sale/maintenance 375–409k · 4-reading batch 572k |
| Cost | 1 gwei gas price: ≈ 0.00004–0.0006 tGLM per write; ≈ 1 tGLM for a full day of 1-minute readings and 30-s heartbeats |
| Block time | 2.0 s (measured over 1,800 blocks) |
