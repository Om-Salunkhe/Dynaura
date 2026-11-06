# Session: dy-0g

Read `BRIEF.md` and `DECISIONS.md` first. Work in your own git worktree, on branch `pawan/zerog`.

**Goal:** make the 0G Physical AI submission airtight. 0G requires:
- a 0G call inside the decision loop
- an episode log on 0G Storage with a request ID per decision
- a live hardware demo at the booth
- a safe stop if 0G is unreachable (a fake fallback disqualifies)
- contract deployment addresses

The exact brief is in our prize research notes (`prizes-full.md`, "Physical AI: Agents with a Body"); the team's 0G plan is a PDF kept outside the repo (read only).

**Pawan approved:**
1. **EpisodeRegistry on 0G Galileo** (chain 16602, Solidity 0.8.19, evmVersion cancun per 0G's deploy guide):
   - `record(bytes32 root, string chatId, bool ai)`, callable only by the device, emitting `Episode(n, root, chatId, ai)`
   - deploy it and verify it on chainscan-galileo
   - Put the contract + a deploy script in a new `zerog/` folder (yours).
2. **Link 0G proofs into the money trail:** each cleaning decision should carry its 0G request ID and storage root, through the Arkiv `cleaning_job` record (coordinate field names with `dy-arkiv` via the manager) and the Arc escrow (`dy-arc` adds `ogRequestId` + `linkEpisode`).
3. **Pi-side wiring as a reviewable patch for Om** (he owns `pi/`; make the changes on your branch, minimal and clearly separated, and tell the manager what you touched):
   - Call `EpisodeRegistry.record()` after each 0G Storage upload.
   - Retry failed Storage uploads from the episodes/ queue, so the "reconnect" demo beat works.
   - In the cleaning flow: the meter threshold *triggers*, but **one 0G call confirms `panel_dirty` before any escrow opens**. If 0G is down, no escrow opens, and that's logged as `no-ai`. Om said he'll do this himself, so check with the manager before writing it; at minimum leave the hook ready.

**First:** audit `pi/zg.py`, `pi/brain.py`, `pi/planner.py`, `pi/og_storage.py` and `pi/jobs.py` against the 0G checklist, and send the manager a short gap list.
- Then find out what funds you need: 0G testnet tokens from faucet.0g.ai (0.1 0G per wallet per day) for deploy and record calls.
- Generate a test deployer key into a private env file outside the repo (never printed), and give the manager its address so Pawan can fund it, unless Om's existing 0G wallet should be used.
