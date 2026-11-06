# Session: dy-arc

Read `BRIEF.md` and `DECISIONS.md` first. Work in your own git worktree, on branch `pawan/arc`.

**Goal:** a qualifying Arc submission. **"Every Arc prize requires using Arc Studio as the starting point"**, and the submission needs the Studio project URL, Studio shown in the demo, a working frontend + backend, an **architecture diagram**, a video and the GitHub link. The best-fit bounty is **"Best Smart Contracts with Advanced Stablecoin Logic, In Arc Studio"**: conditional escrow with automatic release is literally on its list, as are payment splitting and treasury. A second candidate is "Best DeFi / Onchain Finance App Built End to End in Arc Studio". You can read the exact briefs in our prize research notes (`prizes-full.md`, Arc section).

**You own:** `contracts/`, Arc integration review (`pi/arc.py` is Om's: propose changes, don't edit; `web/src/lib/arc.js` is yours), and the Arc parts of the docs.

**Tasks:**
1. **Research Arc Studio for real:** is there a CLI (`arc-studio`?) or API you can drive, how do projects, contract generation, tests and deploy work, and how do you get a project URL? Use the official docs only (arc.io, studio.arc.com/studio.arc.io, docs.arc.network…). Write down exactly which steps need a human in the browser (login, faucet), as a click-by-click checklist for Pawan.
2. **Make Studio the starting point:** prepare the exact Studio prompt(s) that describe our three contracts (CleaningEscrow, ShopTrade, SolarBilling), so Studio generates and tests them. Then reconcile Studio's output with the repo versions, keeping the safest logic (USDC is ERC-20 at `0x3600…0000` with 6 decimals; never `payable`/`msg.value`; SafeERC20; reentrancy guard; oracle = the Pi wallet). The final contracts must live in the Studio project, and the repo copy must match what Studio deployed.
3. **Review and test the contracts:** escrow open → accept → release on clean proof (> 90%) or refund at the deadline; edge cases; events carrying the 0G episode root/request ID so a judge can link the payment to the AI decision. Run the local tests.
4. **Deploy** (once Pawan has done the Studio and faucet steps): fill `contracts/deployments.json`, and run an end-to-end script on Arc testnet (open → release) with real tx links.
5. **Architecture diagram** (Arc requires one): Pi ↔ 0G ↔ Arc ↔ Arkiv ↔ web.

**Milestone:** first report the Studio research and the human checklist to the manager. That's what Pawan needs most urgently.
