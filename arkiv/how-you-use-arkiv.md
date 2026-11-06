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
| **Dyna's planner prompt** (Pi, via bridge `GET /history`), **History** | `dynaura.daily_output` | `building = …` | `day` desc, 7 | The AI plans tomorrow from the building's own last week, read back from the open record | Yes |
| **Admin: "Building online"** badge | `dynaura.heartbeat` | `building = …` | `updated` desc, 1 | **No row means offline**: the heartbeat expired because the Pi stopped renewing it | Yes |
| **History** timeline, **Home** "Recent on Arkiv" | `dynaura.decision` | `building = …` | `decision_id` desc, 15 | Each row links its 0G request ID and 0G Storage root | Yes |
| **History**, **Admin upkeep** | `dynaura.maintenance` | `building = …` | `at` desc, 10–20 | `at` is an unindexed sort key (see friction #6) | Yes |
| **Shop offers** | `dynaura.offer` | `building = …` | `window_end` asc, 20 | Expired offers are not returned: **the market closed itself** | Yes |
| **Cleaner job board** | `dynaura.cleaning_job` | `building = …` **and `status` ∈ {open, accepted, cleaned}** (or one state, e.g. `flagged`) | `created_at` desc, 20 | One entity per request from flag to payout; the indexed status makes each board one query | Yes, with the 0G and Arc proof links |
| **Job → its 0G decision** (proof chip on a job) | `dynaura.decision` | `building = …` **and `og_request_id = <the job's og_request_id>`** | 1 | Joins Arc escrow → Arkiv job → 0G decision with one indexed lookup | Read ready (`fetchDecisionByOgRequest`) |
| **Resident Bill**, **History** | `dynaura.bill` | `building = …` **and `flat = A`** (or `month = 2026-11`) | `month` desc, 12 | A flat sees its own bills; the committee filters by month | Yes |
| **Admin trading** | `dynaura.sale` | `building = …` (and `buyer = <shop wallet>`) | `order_id` desc, 20 | A shop can find its own receipts by wallet | Yes |
| **Verify payout** (a paid job's proof) | `dynaura.reading` | `building`, **`meter = panel`**, **`minute` between the job's `proof_from` and `proof_to`** | `minute` desc | Re-fetch the exact signed readings the escrow paid on and recompute its hash | Yes: Verify payout (`verifyJobPayout`) checks every signature in the window and the hash against the one on Arc |
| **Bridge internals** | `daily_output`, `cleaning_job`, `heartbeat` | `day = …` / `case_id = …` (or `job_id`) | 1 | Find today's totals or a request's entity to patch it; recover the live heartbeat after a restart | Yes (bridge) |
| **Keeper** (every 6 h) | maintenance, bill, sale, daily_output | **`$expiresAt <= head + 30 days`** | 20 | Extend records worth keeping before they lapse | Yes (bridge) |

The same queries run in our live smoke test
([`bridge/smoke.mjs`](../bridge/smoke.mjs), 36/36 checks), so what we test is what the screens show.

## Reads from the browser, and the access key

The web app queries Arkiv from the browser. `rabdi()` puts an access key in the RPC URL, so any key
in the bundle is public. Arkiv's security guidance keeps operator keys server-side, so **the
bridge's key never goes to the browser**. The app uses either:

- a **separate, public, read-only key made just for the web app** (`VITE_ARKIV_PUBLIC_READ_KEY`),
  restricted to the app's origin if the Arkiv hub allows it, and revoked after the event; or
- no key: the public endpoint.

Either way, reads back off with jitter and errors are redacted before they're shown
([`arkivReads.js`](../web/src/lib/arkivReads.js)).

We measured why the separate key is worth it. These are the web app's own five queries (decisions,
maintenance, heartbeat, offers, open jobs), fired together as one "page load", from one machine:

| When (6 Nov 2026) | Endpoint | Load | Succeeded | 429s | Page load p50 / p95 |
|---|---|---|---|---|---|
| 09:00, quiet | keyless | 20 loads, 3 s apart | **100/100** | 0 | 953 ms / 4.4 s |
| 09:00, quiet | keyless | 4 viewers × 25 loads at once (~40 queries/s) | **500/500** | 0 | 425–461 ms / 599–887 ms |
| 22:30, venue busy | keyless | 12 loads, 2 s apart | **4/60** | 223 of 228 requests | 6.3 s / 16 s |
| 22:30, venue busy | with a key | 12 loads, 2 s apart | **60/60** | 0 | 686 ms / 1.0 s |

The 429s say `ANON_COST_LIMITED: unauthenticated query budget exhausted`: anonymous reads share
a cost budget, and once it's spent they fail until it resets. During judging the whole venue shares
a few IPs, so the demo uses the public-app key.

## Trust and edit rights

| Who | Can | How it's enforced |
|---|---|---|
| **Building wallet** (on the Pi) | Create every record. Patch only heartbeat, daily totals, cleaning jobs. Extend lifetimes. | The bridge is the only process with the key; it listens on 127.0.0.1 only |
| **Building wallet** | **Not** change a bill, sale, reading, offer, maintenance entry, or a decision with its proof, after it is written | Created with `flags: { readonly: true }`. Arkiv itself refuses the change |
| **Building wallet** | Add a missing 0G root to a decision **once** (0G Storage was offline when it was written) | The bridge patches only `og_storage_root`, only if the decision has none, and refuses a different one (`409`) |
| **Anyone else** | Write entities with our schema tags, even hand them to our wallet | Every read requires `$creator = w AND $owner = w`. [`trust-check.mjs`](../bridge/trust-check.mjs) proves it live: a stranger's fake "pay the cleaner twice" decision, transferred to our wallet, shows up under `.ownedBy()` alone and not under ours |
| **The Pi's device key** (separate from the wallet) | Sign each 1-minute meter summary | `sig` + `signer` stored on every reading; anyone can recover the signer. **Checked live (6 Nov):** all 76 readings of `sunrise-apartments` on Arkiv recover to the Pi's device key `0x1EADd213…52Ed` |

## Expiry as product logic

| Record | Expiration we set | What happens when it expires |
|---|---|---|
| Heartbeat | `fromMinutes(2)`, renewed every 30 s with **patch + extend in one atomic batch** | App shows "Building offline". No monitoring server |
| Offer | `atDate(window_end)` with an `atLeast` of 2 min | Shops stop seeing it at sunset |
| Cleaning request | `fromHours(48)` when 0G flags it; extended to `atDate(deadline + 7 days)` on approval; +7 days on a dispute | A flag nobody approves disappears; a finished job leaves the board after the dispute window |
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

From the smoke test run on 6 Nov 2026 against the test building `test-dyarkiv-1` (the same wallet as the live building,
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

**On the live building** `sunrise-apartments`, written by the Pi's own bridge (same wallet):

| What | Entity |
|---|---|
| A signed panel reading (one of 76 live readings on 6 Nov, 22:30) | [`0x252c1092…`](https://rabdi.explorer.arkiv.network/entity/0x252c10922d71e999d50f56109234b93b6d653095f7e46555d4be93c75dc028b0) |
| The no-AI safe stop: "0G unreachable: building runs on grid, no jobs moved" | [`0x798036b1…`](https://rabdi.explorer.arkiv.network/entity/0x798036b1c95ac505f4937ed8484547b50ae10c5fe794e059445acb5f6ea79c39) |
| Today's daily totals | [`0xdee82c66…`](https://rabdi.explorer.arkiv.network/entity/0xdee82c66a2b47991cf939a8458d006c785d10e2050174de0e479a3aab3584e87) |

The demo run's decisions, with their 0G request IDs, storage roots and Arkiv entities, are in the
README's proof table.

## Measured

Live on Rabdi, 6 Nov 2026, from Mumbai, with an access key:

| | Value |
|---|---|
| Write, end to end (POST to the bridge → receipt) | **3.4–4.0 s** average over 15 writes per run (fastest 1.8 s) |
| Read (the web's queries) | **0.36–0.65 s** average over 9 queries |
| Gas per write | heartbeat renewal 73k · daily patch 43k · cleaning-job patch 50–59k · offer 128k · decision 219k · bill/sale/maintenance 375–409k · 4-reading batch 572k |
| Cost | 1 gwei gas price: ≈ 0.00004–0.0006 tGLM per write; ≈ 1 tGLM for a full day of 1-minute readings and 30-s heartbeats |
| Block time | 2.0 s (measured over 1,800 blocks) |
