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
| **Resident Bill** | `dynaura.bill` | `building = …` **and `flat = A`** (or `month = 2026-11`) | `month` desc, 12 | A flat sees its own bills; the committee filters by month | Read ready (`fetchBills`); **TODO** wire the screen |
| **Admin trading**, shop receipt | `dynaura.sale` | `building = …` (and `buyer = <shop wallet>`) | `order_id` desc, 20 | A shop can find its own receipts by wallet | Read ready (`fetchSales`); **TODO** wire the screen |
| **Panel proof** (escrow release) | `dynaura.reading` | `building`, **`meter = panel`**, **`minute >= t`** | `minute` desc, 60 | The release proof hashes the last 3 signed panel readings, which anyone can re-fetch and verify | Read ready (`fetchReadings`) |
| **Bridge internals** | `daily_output`, `cleaning_job`, `heartbeat` | `day = …` / `job_id = …` | 1 | Find today's totals or a job's entity to patch it; recover the live heartbeat after a restart | Yes (bridge) |
| **Keeper** (every 6 h) | maintenance, bill, sale, daily_output | **`$expiresAt <= head + 30 days`** | 20 | Extend records worth keeping before they lapse | Yes (bridge) |

The same queries run in our live smoke test
([`bridge/smoke.mjs`](../bridge/smoke.mjs), 32/32 checks), so what we test is what the screens show.

## Trust and edit rights

| Who | Can | How it's enforced |
|---|---|---|
| **Building wallet** (on the Pi) | Create every record. Patch only heartbeat, daily totals, cleaning jobs. Extend lifetimes. | The bridge is the only process with the key; it listens on 127.0.0.1 only |
| **Building wallet** | **Not** change a bill, sale, reading, decision, offer or maintenance entry after it is written | Created with `flags: { readonly: true }`. Arkiv itself refuses the change |
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
the heartbeat's remaining life and the keeper's last run. Ten offline tests
([`writer.test.mjs`](../bridge/writer.test.mjs)) cover the failure paths.

## Live transactions

From the smoke test run on 6 Nov 2026 against the test building `test-dyarkiv-1` (test wallet
[`0xd961…17Cd`](https://rabdi.explorer.arkiv.network/address/0xd961a5C42dd84F003Ef3C85a1bD08BE59A8717Cd)).
This is the hero moment's Arkiv trail in order:

| Step | What Arkiv records | Transaction |
|---|---|---|
| Meters (every minute) | 4 signed readings in one sealed batch | [`0x5353ec51…`](https://rabdi.explorer.arkiv.network/tx/0x5353ec51cca74540f86ddc86c509b1602ccbf0047d2161871eb3c2a44490bf7c) |
| Building online | Heartbeat patch + extend, one tx | [`0x1516e956…`](https://rabdi.explorer.arkiv.network/tx/0x1516e9560a8ca753d9b8d12dcbe4974bbe90441eccafe3e30d6a37b2483f4347) |
| Dyna plans (0G) | Decision with 0G request ID + storage root, sealed | [`0x55ce72ee…`](https://rabdi.explorer.arkiv.network/tx/0x55ce72eeb3450a9ad4945fccde22af14fabd4a3c10694bae432e80303cddaf89) |
| Spare solar for shops | Offer, expires at the window end | [`0xe0be6505…`](https://rabdi.explorer.arkiv.network/tx/0xe0be6505276c4b4324c392f74ba80498a96005753f115203af102ce1146ce5b1) |
| Panel dirty → escrow opens (Arc) | Cleaning job `open`, output 52% | [`0xf4a6fe39…`](https://rabdi.explorer.arkiv.network/tx/0xf4a6fe393999e88b76cd514abf62b91fa623c0f78571481bad61ff05cfcb3993) |
| Cleaner accepts | Patch `status = accepted` | [`0x42079121…`](https://rabdi.explorer.arkiv.network/tx/0x42079121be8688a2e50fd6b7171efe955a4b49a8502eb65853a63568e99c6ac1) |
| Meter sees 94% → USDC released | Patch `status = paid`, `output_after = 94.1` | [`0x1fc63a1a…`](https://rabdi.explorer.arkiv.network/tx/0x1fc63a1aa6e7be67478ec720bd34709b4f04bbce816960513b45119b41d0ebda) |
| Lasting record | Maintenance entry, sealed | [`0x07dcc7b5…`](https://rabdi.explorer.arkiv.network/tx/0x07dcc7b50c534de1a7d378a2ea0436dcd3f146fa973a6f35161195a054ed0c07) |
| Shop pays on Arc | Sale, sealed | [`0x60e7cb29…`](https://rabdi.explorer.arkiv.network/tx/0x60e7cb2972edeb8a36b9b8d1a4968315fd21c88a31f247d71340ceb7974d16c8) |
| Month end | Bill for flat A, sealed | [`0xcff6f083…`](https://rabdi.explorer.arkiv.network/tx/0xcff6f08300c863dc2d58bab60d8e0835f7f83367b956a63ebcb9dcacfc69ccbb) |

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
