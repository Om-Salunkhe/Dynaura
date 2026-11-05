Build the app's frontend in `src/`: a single page called **Dynaura: Panel cleaning escrow**, for the `CleaningEscrow` you just deployed on Arc Testnet. Use viem and the deployed address and ABI. Keep it clean, light and mobile-friendly.

- **Header:** contract address (explorer link), oracle address, the release rule ("pays when the panel's meter reads ≥ 90%"), and a "Connect wallet" button (injected wallet; switch to or add Arc Testnet 5042002).
- **Jobs list,** newest first, read from `nextJobId` and `jobs(id)`. Show: status chip, fee in USDC (6 decimals), payer, cleaner, deadline countdown, output before → after, the 0G request ID (`ogRequestId`), the meter `proof` hash and the 0G Storage `episodeRoot` (when set).
- **Actions** for the connected wallet, only when they are allowed: `accept` (Open job, not the payer), `dispute` with a reason (cleaner, Accepted, before the deadline), `cancel` (payer, Open), `refund` (after the deadline, or after the deadline plus the dispute window when Disputed). Show each transaction hash as an explorer link and refresh after it is mined.
- **Live feed** of the contract's events (`JobOpened`, `JobAccepted`, `JobPaid`, `JobRefunded`, `JobCancelled`, `JobDisputed`, `DisputeResolved`, `EpisodeLinked`), polling every 3 s, each line with its transaction link.
- **No owner or oracle buttons:** those calls come from the Pi.
- **Empty state:** "No cleaning jobs yet. When the panel's output drops under 70%, the building's AI opens one automatically."
