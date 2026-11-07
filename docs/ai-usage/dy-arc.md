# AI usage: dy-arc (Arc contracts and Arc Studio)

An AI coding session (Claude Code) helped with the Arc side. Everything it produced was reviewed and committed by the team.

| When (IST) | What the AI did | Human part |
|---|---|---|
| Fri 01:00 | Researched Arc Studio from the official sources (studio.arc.io, its llms.txt, the `@circle-fin/arc-studio-cli` package, docs.arc.io) and the Arc testnet facts (checked against the live RPC). Wrote `contracts/STUDIO.md`. | Pawan signs in to Studio, authorizes the CLI and uses the faucet |
| Fri 01:00 | Drafted the Arc Studio prompts in `contracts/studio/` that describe our three contracts, so Studio generates, tests and deploys them | Team reviews the spec |
| Fri 01:30 | Wrote the v2 reference contracts (`src/`) and 50 Foundry tests, including fuzzing, to check Studio's output against. Added an exact-amount USDC approval to `web/src/lib/arc.js`. Tested a proposed `pi/arc.py` patch against the v2 contracts on a local anvil chain. | Om reviews and applies the `pi/` patch; the final contract code comes from Arc Studio |
| Fri 10:00–11:30 | Drove Arc Studio through its official CLI: Studio wrote the three contracts and 161 tests, then ran our 50 tests as acceptance tests (211 green), then deployed and verified the contracts on Arc testnet. The AI pulled the code back, re-ran the tests locally, checked the deployed bytecode against `src/` and recorded `deployments.json`. | Pawan signed in to Studio and authorized the CLI |
| Fri 22:15–23:30 | Cleaning flow v3: wrote the Pi state machine and API (`pi/cleaning.py`, `pi/api.py`) and its tests. Generated the committee wallet, wrote the handover and e2e scripts (viem), tested them on anvil, then ran them on Arc testnet: ownership moved to the committee, and the escrow, dispute and split-bill transactions are recorded in the README table. | Om reviews the `pi/` changes |
| Sat 00:15–01:20 | Fair share: wrote the SolarCredits spec and 15 acceptance tests first (checked against a throwaway reference), then drove Arc Studio to write, test (318 green) and deploy the contract. Verified it on-chain (roles, explorer, bytecode = `src/`), added the Pi's `arc.py` calls agreed with dy-arkiv, and ran Pawan's day on Arc testnet: A was paid 3× B. | Pawan had authorized the Studio CLI earlier |
