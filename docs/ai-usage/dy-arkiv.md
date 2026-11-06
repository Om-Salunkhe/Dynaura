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
- **Drafted the judging files** in `arkiv/` from what was measured and observed. `reach.md` and
  the demo-wallet fields are left as TODOs for the humans; no numbers were invented.

## What humans did

Pawan and the manager session set the scope and the order of work, and reviewed and merged. The
product, the hardware and the Pi core are the team's (Om, Devang, Pawan).

## Notes

- All on-chain writes went to Rabdi testnet from a shared test wallet.
- The code was written during the hackathon; nothing was pasted from other projects.
