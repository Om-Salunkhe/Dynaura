# AI usage: dy-arkiv session

**Tool.** Claude Code (Claude Opus), run as one of Pawan's build sessions. A manager session set
the scope; humans decided what to build and reviewed the output.

**Area.** `arkiv/` (judging files), `bridge/` hardening, and the web app's Arkiv read library
(`web/src/lib/arkiv.js`, `arkivReads.js`, `arkivSchemas.js`).

## What the AI did

- **Audited** the existing bridge, schemas, Pi client and web reads against the installed SDK
  1.0.1 source and Arkiv's published agent skills (github.com/Arkiv-Network/skills).
- **Ran live checks on Rabdi** with a test wallet and a test building id, never the demo building.
  It wrote a smoke test that posts every schema and reads it back with the web's own queries.
- **Found and fixed bugs, each confirmed live:**
  - the SDK gas estimate ran out of gas on back-to-back heartbeat renewals
  - an RPC URL setting silently dropped the access key
  - concurrent writes could collide on the nonce
  - a bridge restart created a second heartbeat
  - readers scoped only by owner were spoofable through an ownership transfer
- **Wrote the hardened write path** (`bridge/writer.mjs`): a single queue, explicit
  nonce/gas/gasPrice, reconciliation by hash or nonce instead of resending. It also wrote the
  offline tests, the keeper, the readonly ("sealed") fact records, and the trust check.
- **Drafted the judging files** in `arkiv/` from what was measured and observed, and later
  rewrote them against the live building. No numbers were invented. What only the team can say
  (the video and live-app links, whether they'll keep building) is left marked for them.
- **Cleaning flow v3** (spec: the team's DECISIONS row, Fri 22:12):
  - It extended `dynaura.cleaning_job` to one entity per request, from 0G's flag to payout,
    patched on every transition, with a lifetime that follows the job.
  - It added `bridge/jobs.mjs` with offline tests.
- **Payout verification** (`web/src/lib/arkivProof.js`): it rebuilt the Pi's Python strings
  (signed reading messages, the escrow's proof hash) in JavaScript, checked them against Python's
  own output, and verified all 76 live readings' signatures from Arkiv.
- **A cleaner-owned work receipt:** created by the building and transferred to the cleaner's
  wallet in one atomic batch.
- **Measured the public endpoint** under load. When the evening numbers contradicted the morning
  ones, it changed its recommendation: the web app now uses a separate public read key.
- **Mistakes it made and fixed:**
  - It once printed the shared access key into a local log through a viem error. The log was
    deleted, and every printed error is now redacted.
  - It stated timestamps it hadn't checked (corrected).
  - It recommended keyless reads from a single morning measurement.

## What humans did

Pawan and the manager session set the scope and the order of work, and reviewed and merged. The
product, the hardware and the Pi core are the team's (Om, Devang, Pawan).

## Notes

- All on-chain writes went to Rabdi testnet from a shared test wallet.
- The code was written during the hackathon; nothing was pasted from other projects.
