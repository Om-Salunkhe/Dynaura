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

## Round 2 (Fri night): cleaning flow v3

| Area | Work | How it was checked |
|---|---|---|
| `zerog/` | Deployed and verified EpisodeRegistry on Galileo (`0xb62f4531…a984`) | Contract source readable on chainscan-galileo; `count()` / `device()` read back |
| `pi/camera.py` | The frame Dyna looks at: uploaded photo, real camera command, fixed file, or (SIM only) the placeholder frames. On real hardware with no camera it returns nothing rather than a stock picture | `pi/tests/test_dust_check.py` |
| `pi/assets/camera/` | Synthetic placeholder frames (clean / dusty), drawn with Python, to be replaced by real photos | Looked at both images |
| `pi/dust.py` | `check_dust`: 0G vision model on the photo, else 0G text model on the meter readings (`input = "meter-only"`); records the `dust` decision and its episode; raises (and records nothing) when 0G gives no verdict, so `pi/cleaning.py` logs `no_check` | Mocked 0G Router over HTTP: vision, missing vision model, no photo, no verdict, TEE failed, unreachable |
| `pi/zg.py` | `model` parameter; a missing model is a separate error so the vision call can fall back | Same tests |

Found by reading the Router's public `/models` list rather than assuming: 0G's own `0gm-1.0-35b-a3b` takes text and images and is the only TEE-attested (TDX) vision model listed, so it is the default `ZG_VISION_MODEL`.

## Round 3 (Sat night): fair share + solar credits

| Area | Work | How it was checked |
|---|---|---|
| `pi/trader.py` | `decide_routes`: 0G, as market maker, decides who buys the spare sun (neighbours who used more than their share, the shop, the grid) and the neighbour price. The Pi caps every buyer, keeps the price inside the export..import band, and sends whatever is left to the grid. With no 0G, the whole spare goes to the grid at the feed-in rate, recorded as `no-ai`. Also `trades()` for the API and `TradeLoop` | `pi/tests/test_trader.py`: a mocked 0G Router over HTTP (the noon example, over-routing, more demand than spare, no routes, TEE failed, nothing to sell, no store, the loop, 0G unreachable) |
| `pi/planner.py` | With credits on, a "spare sun forecast" line in the prompt and a `spare_plan` key in the plan; with credits off the plan is unchanged | Same test file |

Measured live on `router-api.0g.ai` (Sat ~01:00): a trade took 82.6 s with the model's thinking on (1,949 reasoning tokens). With `chat_template_kwargs: {enable_thinking: false}` it took 5.6-11.3 s with 0 reasoning tokens and the same routes on the test cases. The `/no_think` prompt suffix did not turn thinking off (44-53 s). Trades use thinking off; the plan and the dust check keep it.
