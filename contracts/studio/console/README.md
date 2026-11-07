# Dynaura

A web page and onchain contracts for AI-run shared solar in one apartment building: a cleaning-fee escrow released by the panel's own meter, prepaid sales of spare solar to a nearby shop, and monthly bills per flat split between the society and the grid. All money is USDC on Arc testnet.

Built with [Arc Studio](https://studio.arc.io)

## Tech stack

- Solidity ^0.8.24 with OpenZeppelin v5
- Foundry (forge) for tests
- Vite, React, TypeScript, Tailwind, wagmi and viem for the web page

## The page

A single page, "Dynaura: Panel cleaning escrow", shows the cleaning escrow on Arc testnet: every job with its status, fee, payer, cleaner, deadline countdown, panel output, the 0G request ID, meter proof and 0G Storage log, plus a live feed of contract events. Connect a browser wallet to accept, dispute, cancel or refund jobs. Owner and oracle actions are made by the Pi, not from this page.

## Contracts

Sources are in `contracts/`:

- `CleaningEscrow.sol`: locks a cleaning fee, pays the cleaner when the meter confirms a clean panel, refunds otherwise. Each job stores the 0G request ID of the AI decision and, later, the 0G Storage root of its episode log.
- `ShopTrade.sol`: a shop prepays for spare noon solar; the meter settles the real amount and the rest is refunded.
- `SolarBilling.sol`: the meter posts each flat's monthly bill; paying splits the solar part to the society treasury and the grid part to the electricity board.

## Development

Prerequisites: [Bun](https://bun.sh) and [Foundry](https://book.getfoundry.sh).

```
bun install
forge test -vv
```

Run the page with `bun run dev`.

Environment variables (public values, set in `.env`):

- `VITE_CLEANING_ESCROW_ADDRESS`: address of the deployed CleaningEscrow the page reads and writes.
- `VITE_CLEANING_ESCROW_DEPLOY_BLOCK`: block that contract was deployed at; the live feed never reads before it.

Deployed on Arc testnet (addresses in `AGENTS.md`). Each contract takes the USDC address, the oracle (meter wallet), the committee owner and, where relevant, the treasury as constructor arguments.
