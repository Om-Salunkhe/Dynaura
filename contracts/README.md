# contracts

Dynaura's USDC contracts on Arc. They are **generated, tested and deployed in Arc Studio** (see [STUDIO.md](STUDIO.md) for how, and for the Studio prompts in `studio/`). `src/` is the code Studio deployed, and `deployments.json` has the addresses.

| Contract | What it does |
|---|---|
| `CleaningEscrow` | The panel is dusty, so its cleaning fee is locked in USDC. A cleaner accepts the job, and **the meter releases the fee once output is back to at least 90%**. If nobody cleans it by the deadline, the society is refunded. The cleaner can dispute (on a cloudy day, for example), and the committee then decides. Each job carries the **0G request ID** of the AI decision that opened it and the **0G Storage root** of that decision's episode log, and each payout carries the hash of the meter readings that proved the clean. |
| `ShopTrade` | A nearby shop prepays for spare noon solar. After the window, the meter settles **in one transaction**: the society is paid per Wh delivered (rounded down) and the shop gets the rest back. If the meter never settles, the shop takes its deposit back after the deadline. |
| `SolarBilling` | Each month the meter posts each flat's bill, computed from that flat's own meter, along with the hash of the signed readings behind it. **One payment is split by where the power came from:** the solar part goes to the society treasury and the grid part to the electricity board. |

## Shared rules

- **USDC** is the ERC-20 at `0x3600000000000000000000000000000000000000`, with 6 decimals: `2000000` = 2 USDC. Nothing is `payable`, and there are no native transfers.
- **The oracle** is the Pi's wallet. It is the only address that can release a fee, settle a sale or post a bill, and it only does so from what its own meters measured. The **owner** (the society committee) can change the oracle and treasury and resolve disputes. Both are set in the constructor, because Studio deploys from its own wallet.
- **Safety:** OpenZeppelin `SafeERC20`, `ReentrancyGuard` and `Ownable`. Contracts use checks-effects-interactions and custom errors, and emit an event for every state change. `totalLocked` always equals the USDC the escrow holds; a fuzz test checks this.

## The escrow, step by step

```
openJob(fee, deadline, outputBefore, ogRequestId)    payer locks USDC          -> Open
accept(jobId)                                         a cleaner takes it        -> Accepted
release(jobId, outputAfter >= 90, proof)              oracle: meter says clean  -> Paid (USDC to the cleaner)
linkEpisode(jobId, ogStorageRoot)                     oracle: 0G Storage root of the AI episode
cancel(jobId)                                         payer/oracle, still Open  -> Cancelled (USDC back)
dispute(jobId, reason)                                cleaner, before deadline  -> Disputed
resolve(jobId, payCleaner)                            committee                 -> Paid or Refunded
refund(jobId)                                         anyone, after the deadline (disputed: +3 days) -> Refunded
```

## Tests

```bash
cd contracts
npm install                                   # OpenZeppelin + solc for the ABIs
forge install foundry-rs/forge-std --no-git   # once
forge test                                    # 50 tests, including fuzzing
npm run build                                 # writes abi/*.json (read by pi/ and web/)
```

`test/MockUSDC.sol` exists only for these tests. Never deploy it.

## After a deploy

Copy the three addresses into `deployments.json`, into `.env` (`ARC_ESCROW`, `ARC_SHOP`, `ARC_BILLING`) and into `web/.env` (`VITE_ARC_ESCROW`, `VITE_ARC_SHOP`, `VITE_ARC_BILLING`).
