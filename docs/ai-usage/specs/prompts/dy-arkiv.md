# Session: dy-arkiv

Read `BRIEF.md` and `DECISIONS.md` first. Work in your own git worktree, on branch `pawan/arkiv`.

**Goal:** win Arkiv's "Build on Arkiv (from scratch)" prize ($4k). It's judged 25% each on the feedback file, reach, why Arkiv, and how we use Arkiv, plus the required `schema.md`, the wallet address(es) and one runnable query in the README.

**You own:** `arkiv/`, hardening of `bridge/`, and `web/src/lib/arkiv.js` + `web/src/lib/arkivSchemas.js`, which hold the read side. For anything else in `web/`, coordinate with `dy-web` via the manager.

**Tasks, in order:**
1. **Audit what exists:** `bridge/*.mjs`, `arkiv/schema.md`, `pi/arkiv.py` (read only; it's Om's), and web's Arkiv reads. Do they match each other and the SDK 1.0.1 API? Are the readers trust-scoped (`ownedBy` building wallet), the expiries sensible, and patch/extend used correctly (e.g. the heartbeat extends every 30 s)?
2. **Live check on Rabdi** with a test building wallet and test building id. Use the shared test access key and the funded test wallet. Start the bridge from your worktree with them, post sample records for every schema, read them back the way the web does, and time them. Fix bugs on your branch.
3. **Hardening:** viem `pollingInterval: 1000` + `blockTime: 2000`, 429 backoff with jitter on reads, never resending txs blindly (reconcile by hash/nonce), a bounded queue, and clear health output. Confirm whether `patchEntity` keeps the expiry, and how the heartbeat's "2-minute expiry = offline" behaves.
4. **Judging files** in `arkiv/`: `friction.md` (real, reproducible items you hit), `why-arkiv.md` (what a normal DB would lose: an open record book, expiry as product logic such as "offers close at sunset" and "offline when the heartbeat expires", wallet ownership), `how-you-use-arkiv.md` (filters ↔ screens, edit rights, expiry, live tx links), `reach.md` (draft, with TODOs for Pawan/Om), and update `schema.md`. Plus a README block: wallet + one runnable curl query (tested).

**Milestone:** report to the manager when (2) passes live, and again when the judging files are drafted.
