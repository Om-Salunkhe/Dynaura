# Why Arkiv

Dynaura runs one shared rooftop panel for a building of flats. An AI (Dyna, on 0G) decides who
gets the sun and when the pump runs. Arc moves the money: bills, shop sales, and a cleaning escrow
that pays only when the meter proves the panel is clean. That leaves a question every resident,
cleaner and shopkeeper will ask: **"Says who?"**

> 0G decides, Arc pays, **Arkiv remembers**.

Arkiv is where the building writes down what happened: readings, decisions, jobs, offers, bills.
Nobody has to trust the housing committee's laptop to read them.

## What a normal database would lose

### 1. The record book would belong to whoever runs the server

In an Indian housing society, the committee keeps the books, and disputes about the electricity
split, the cleaner's pay or the maintenance fund are common. With Postgres behind an API, the
committee (or whoever has the password) could quietly edit last month's bill or a meter reading,
and residents would only see what the API chose to show.

On Arkiv:
- **Every record is written by one building wallet,** and the address is public.
- **The app reads Arkiv straight from the browser,** with no Dynaura server in between
  ([`web/src/lib/arkivReads.js`](../web/src/lib/arkivReads.js)). A resident, the cleaner, a shop or
  a judge can run the same query with `curl` (see the [README](README.md)) and get the same answer
  the app shows.
- **Facts are sealed.** Bills, sales, signed readings, decisions, offers and maintenance entries
  are created as Arkiv **readonly** entities. The network refuses any later change to their
  contents, even from the building wallet. Only their life can be extended. The records that are
  meant to change (a cleaning job moving to `paid`, today's running totals, the heartbeat) change
  through transactions anyone can see on the explorer.
- **What it doesn't stop:** the building wallet can still delete its own records. A deleted bill
  would leave a gap anyone can notice, plus a public delete transaction, which is a lot more than a
  quiet `UPDATE` leaves.

### 2. Expiry would be a cron job; on Arkiv it is product logic

Every Dynaura record has a lifetime, chosen for what the record means. Expiry does work that would
otherwise need servers and cleanup scripts:

| Record | Lives | What expiry does for the product |
|---|---|---|
| Heartbeat | 2 minutes, renewed every 30 s | **"Building offline" is the heartbeat expiring.** No monitoring server: if the Pi dies, loses power or loses internet, its heartbeat simply stops existing and the app turns red. |
| Shop offer | Until the solar window closes (`window_end`) | **The market closes itself at sunset.** Shops never see a stale offer for energy that no longer exists. Nobody has to delete it. |
| Cleaning job | Until the escrow deadline + 1 day | **The job board clears itself.** The lasting record is the maintenance entry written when the cleaner gets paid. |
| Meter readings | 7 days | **Privacy by expiry.** Minute-by-minute power use shows when a family is home. After a week it is gone; only daily totals remain. |
| Bills, sales, maintenance, daily totals | 180 days, then extended by the building | **Storage has an owner and a cost.** The building keeps its history alive while it runs; if it stops, the history lapses rather than living forever on someone else's disk. |

With a normal database, each of these is a scheduled job that can fail silently. A failed cleanup
cron leaves stale offers on screen; a dead monitoring server means no offline alarm. Here the
lifetime is set once, when the record is written, and the network enforces it.

### 3. Wallet ownership is the permission system

There is no user table and no admin password for the records. The building wallet is the only
writer, and readers accept a record only if that wallet **created it and still owns it**. That
matters: anyone can write an entity with our schema tags, and anyone can hand an entity to our
wallet. We proved both live, and our reads ignore them
([friction #5](friction.md#5-ownedby-alone-can-be-spoofed-with-an-ownership-transfer-the-readme-teaches-it-alone-medium),
[`bridge/trust-check.mjs`](../bridge/trust-check.mjs)). Meter readings carry a second layer: each
one is signed by the Pi's device key, so a reading proves which meter produced it, not just which
wallet posted it.

### 4. It joins the three chains into one story

A decision on Arkiv carries the 0G request ID and the 0G Storage root of its full episode. A
cleaning job carries its Arc escrow ID and transactions. The escrow's release proof is a hash of
the last three **signed panel readings, which are themselves on Arkiv**. One query shows the whole
hero moment, from "panel dirty" to "cleaner paid", with a link to each proof. A normal DB would
hold copies of those links; here the record book is as public as the things it points to.

## Why not just put it all on Arc or 0G?

- **Arc contract storage** is the wrong shape. It is expensive per byte, permanent (no expiry),
  and you can't query "bills for flat A" or "jobs with status open" without building an indexer.
  We use Arc for what needs custody and settlement: USDC in escrow, payments.
- **0G Storage** holds blobs addressed by root hash: perfect for Dyna's full episode logs, but not
  for "the last 7 days of totals, newest first". We use it for the large, permanent proofs and
  point to them from Arkiv.
- **Arkiv** gives typed, indexed, queryable records with an owner and an end date. That is exactly
  a building's record book.

## What it costs

On Rabdi, one write is 43k–572k gas at 1 gwei: 0.00004–0.0006 tGLM. A busy demo day is roughly
1,440 reading batches, 2,880 heartbeats and a few dozen other records: about 1 tGLM. Write latency
is 3–4 s, and the app's reads take about 0.4 s (measured: [how-you-use-arkiv.md](how-you-use-arkiv.md#measured)).
