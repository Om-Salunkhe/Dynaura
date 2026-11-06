# contracts

Dynaura's USDC contracts on Arc. They are **generated, tested and deployed in Arc Studio** (see [STUDIO.md](STUDIO.md) for how, and for the Studio prompts in `studio/`). `src/` is byte-for-byte the code in our Studio project, and `deployments.json` has the addresses.

| Contract | What it does |
|---|---|
| `CleaningEscrow` | The panel is dusty, so its cleaning fee is locked in USDC. A cleaner accepts the job, and **the meter releases the fee once output is back to at least 90%**. If nobody cleans it by the deadline, the society is refunded. The cleaner can dispute (on a cloudy day, for example), and the committee then decides. Each job carries the **0G request ID** of the AI decision that opened it and the **0G Storage root** of that decision's episode log, and each payout carries the hash of the meter readings that proved the clean. |
| `ShopTrade` | A nearby shop prepays for spare noon solar. After the window, the meter settles **in one transaction**: the society is paid per Wh delivered (rounded down) and the shop gets the rest back. If the meter never settles, the shop takes its deposit back after the deadline. |
| `SolarBilling` | Each month the meter posts each flat's bill, computed from that flat's own meter, along with the hash of the signed readings behind it. **One payment is split by where the power came from:** the solar part goes to the society treasury and the grid part to the electricity board. |

## Shared rules

- **USDC** is the ERC-20 at `0x3600000000000000000000000000000000000000`, with 6 decimals: `2000000` = 2 USDC. Nothing is `payable`, and there are no native transfers.
- **The oracle** is the Pi's wallet. It is the only address that can release a fee, settle a sale or post a bill, and it only does so from what its own meters measured. The **owner** is a separate society **committee** wallet: it resolves disputes and can rotate the oracle or treasury. The Pi handed ownership over on-chain (Ownable2Step), so the Pi can't settle its own disputes.
- **Safety:** OpenZeppelin `SafeERC20`, `ReentrancyGuard` and `Ownable2Step` (ownership can't be renounced). Contracts use checks-effects-interactions and custom errors, and emit an event for every state change. Neither the oracle nor the committee can accept a cleaning job, so neither can pay itself.
- **Frozen wallets can't block a job:** if a payout can't be delivered (for example, the USDC issuer froze the recipient's address), the job still settles and the amount waits in `pendingPayout` / `pendingRefund` for that recipient to `claimPayout` / `claimRefund`.
- **Balance invariant:** the escrow always holds at least `totalLocked`, checked by an invariant test.

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

**211 Foundry tests:**
- `test/*.t.sol`: 161 tests written by Arc Studio, including fuzz and invariant tests.
- `test/acceptance/`: our 50 tests, written independently from the same spec. They ran inside Studio too, and Studio didn't change them.

```bash
cd contracts
npm install                                   # OpenZeppelin + solc for the ABIs
forge install foundry-rs/forge-std --no-git   # once
forge test                                    # 211 tests
npm run build                                 # writes abi/*.json (read by pi/ and web/)
```

Mock tokens (`test/MockUSDC.sol`, `test/acceptance/AcceptanceUSDC.sol`) exist only for these tests. Never deploy them.

## On-chain proof (Arc testnet, Fri 6 Nov)

The whole flow, run for real with `scripts/committee.mjs` and `scripts/e2e.mjs`. Every hash is in `deployments.json` under `demoTxs`.

| Step | What happened | Transaction |
|---|---|---|
| Escrow | The Pi locks 0.5 USDC with the 0G request ID (`openJob`) | [`0x5e49a59d…`](https://explorer.testnet.arc.io/tx/0x5e49a59dcc28633377f04ad15ebc66a618f2888f46e072a3ebc1fc225862b894) |
| Escrow | The cleaner accepts (`accept`) | [`0xc206d3d1…`](https://explorer.testnet.arc.io/tx/0xc206d3d13e82271d9b59ed96e4302695be7ac5f472bc09a891b9686d389b9739) |
| Escrow | The Pi links the 0G Storage root of the AI episode (`linkEpisode`) | [`0x4576b794…`](https://explorer.testnet.arc.io/tx/0x4576b7945b58dcb404051ff1ddc75bb8bbeaf5848154d32c70700328efaf3d30) |
| Escrow | The meter proves the clean panel (95%), and the Pi releases the fee to the cleaner (`release`) | [`0xee5a1b1b…`](https://explorer.testnet.arc.io/tx/0xee5a1b1b9d2dea939b125e3b40a4613ab99b12022770b4280a373f819614f2e9) |
| Dispute | The cleaner disputes a second job: "cloudy" (`dispute`) | [`0x7567890a…`](https://explorer.testnet.arc.io/tx/0x7567890a9452e35bfaae8ef36e86f02d75a2d7c82dd63f1dbca898f1d72ab745) |
| Dispute | The Pi tries to `resolve` and is refused (simulated only, never sent) | n/a |
| Dispute | The **committee** resolves it and pays the cleaner (`resolve`) | [`0xdf7ba154…`](https://explorer.testnet.arc.io/tx/0xdf7ba154225fd9f0514323b596aad4f6b27fdf76f80cffb1dd77b9352b0631e8) |
| Billing | The Pi posts a bill from the flat's meter (`postBill`) | [`0x86132eba…`](https://explorer.testnet.arc.io/tx/0x86132eba80d909c0416f530d35f89603bd38fa88f5659fba743a615cf09a3b24) |
| Billing | The resident pays once, and the bill is **split**: solar part to the society, grid part to the electricity board (`pay`) | [`0x21e8b174…`](https://explorer.testnet.arc.io/tx/0x21e8b1741c1550a00324935587b16028da566f1dd87a73e426c17faf5c0cfd87) |
| Ownership | The Pi hands CleaningEscrow to the committee (`transferOwnership`, then `acceptOwnership`) | [`0x0e14b7c0…`](https://explorer.testnet.arc.io/tx/0x0e14b7c01fe353818179ad5767555fe06ce95f053efc9249c580807d439d5229) |
| Ownership | The same for ShopTrade | [`0x765ae598…`](https://explorer.testnet.arc.io/tx/0x765ae598786d70075dc0dd3aa317085aca5959ee819ddf8f8d9d05576b7ec67f) |
| Ownership | The same for SolarBilling | [`0xcbb5c44e…`](https://explorer.testnet.arc.io/tx/0xcbb5c44ede94b5bedbdd33e0231a8d3d82ee773033ea17106a07e350be7e0c10) |

| Role | Wallet |
|---|---|
| Oracle: the Pi, the only key that releases, settles, bills or links 0G roots | [`0xA2F1…1Ccf`](https://explorer.testnet.arc.io/address/0xA2F16C1A2b562349B475046eAb3E9e59B9bD1Ccf) |
| Owner: the society committee, which resolves disputes and can rotate the oracle | [`0x6c11…63D6`](https://explorer.testnet.arc.io/address/0x6c11FAcF7DE8C250A3E648aB9F73fBDaFe5563D6) |
| Treasury (the society) | [`0xA2F1…1Ccf`](https://explorer.testnet.arc.io/address/0xA2F16C1A2b562349B475046eAb3E9e59B9bD1Ccf) |
| Grid payee (stand-in for the electricity board) | [`0x69E5…F140`](https://explorer.testnet.arc.io/address/0x69E52f183FE1D423Da95619986a648194cbFF140) |
| Deployer: Arc Studio's Circle smart wallet (ERC-4337) | [`0x5b12…ef42`](https://explorer.testnet.arc.io/address/0x5b12ce46c7194ad57d143bc22847224047b1ef42) |

## After a deploy

Copy the three addresses into `deployments.json`, into `.env` (`ARC_ESCROW`, `ARC_SHOP`, `ARC_BILLING`) and into `web/.env` (`VITE_ARC_ESCROW`, `VITE_ARC_SHOP`, `VITE_ARC_BILLING`).
