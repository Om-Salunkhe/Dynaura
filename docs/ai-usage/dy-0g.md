# AI usage: dy-0g session

An AI coding assistant (Claude Code) worked on the 0G part of Dynaura in this session. A human (Pawan) and a coordinating session set the scope; Om reviews every change under `pi/` before it is merged. Everything here was written during the hackathon.

## What the assistant did

| Area | Work | How it was checked |
|---|---|---|
| Audit | Read `pi/zg.py`, `brain.py`, `planner.py`, `og_storage.py`, `jobs.py` against 0G's Physical AI checklist and listed the gaps | Read the 0G prize text, the team's 0G plan and 0G's docs |
| `zerog/` | `EpisodeRegistry` contract, Foundry tests, deploy and set-device scripts | `forge test` (8 tests); dry-run against Galileo |
| `pi/og_storage.py` | Retry queue for failed 0G Storage uploads; EpisodeRegistry record after each upload; richer episode logs (0G proof, building snapshot, hash chain) | `pi/tests/test_episode_queue.py` with a fake storage CLI |
| `pi/zg_registry.py` | web3 client for the registry. It never resends a transaction that can still land | Reviewed against the installed web3 API |
| `pi/zg.py` | Fast failure when offline (5 s connect timeout, no retry); reads `x_0g_trace`; refuses answers whose TEE signature did not verify | A local fake Router: verified, unverified, not reported, and an unreachable address |
| `pi/cleaning.py` | A marked hook for Om's 0G dust check; the cleaning job keeps the 0G decision behind it | `pi/tests/test_dust_hook.py` |
| `pi/jobs.py` | Replan today if the Pi runs past midnight on yesterday's plan | Import check; reviewed by hand |
| Arkiv | A decision written before its upload worked gets its root patched in later | Reviewed against the Arkiv SDK's `patchEntity` types |

## Things the AI found by reading sources, not from memory

- The 0G storage CLI logs `root=0x…` while it computes the Merkle root, **before** it uploads (from `0g-storage-client`'s `transfer/uploader.go`). The old parser could therefore record a failed upload as a success. Only the final `file uploaded, root = 0x…` line counts now.
- 0G's Router docs: `x_0g_trace.tee_verified` is `false` when a signature was present but did not verify ("treat the response as untrusted"). The old Ask Dyna label said "TEE verified" in that case too.
- 0G's deploy guide: compile with `evm_version = "cancun"`; verify through `https://chainscan-galileo.0g.ai/open/api`.

## What humans decided

- Scope, ownership and what to build (Pawan and the coordinating session).
- The 0G dust check itself (the prompt and the call) stays with Om; only the hook was added.
- Wallet funding and which wallet is the registry's device.
