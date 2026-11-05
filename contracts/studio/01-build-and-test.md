Build the onchain part of **Dynaura** on Arc testnet: AI-run shared solar for one apartment building. Use the **max preset**: write the three contracts below, write a Foundry test suite and run it. **Do not deploy yet**; that is the next turn.

## The story

A Raspberry Pi meters one rooftop solar panel and three flats (A, B, C). The Pi's wallet is the **oracle**. It is the only address that can release a cleaning fee, settle a shop sale or post a bill, and it only does so from what its own meters measured. An AI planner running on 0G Compute decides when the panel looks dirty. Each AI decision has a 0G request ID (a string), and its episode log is stored on 0G Storage under a `bytes32` root. A judge must be able to go from a USDC payment straight to the AI decision behind it.

The files in `context/` are our first drafts. Keep their contract names, function names, argument order and the order of the existing struct fields, because our Python and React code already call them. Add new struct fields only at the end. Make them safer and finish the logic below.

## Rules for all three contracts

- Solidity `^0.8.24` and OpenZeppelin v5: `SafeERC20`, `ReentrancyGuard` (`nonReentrant` on every function that moves USDC) and `Ownable`.
- The money is the **USDC ERC-20 at `0x3600000000000000000000000000000000000000`, 6 decimals** (`2_000_000` = 2 USDC). Never use `payable`, `msg.value` or native transfers.
- Every constructor takes an explicit `owner_` (the society committee), because the wallet that deploys from Studio is not ours. Revert on `address(0)` for usdc, oracle, owner and treasury, both in the constructor and in the setters.
- Use checks-effects-interactions, custom errors, and an event for every state change. No upgradeability, no `tx.origin`.
- Owner-only `setOracle(address)` (keep the `OracleChanged` event). In ShopTrade and SolarBilling, also add an owner-only `setTreasury(address)`.

## 1. CleaningEscrow: conditional escrow, released by the sun

Lifecycle: `Open` → `Accepted` → `Paid`, plus `Refunded`, `Cancelled` and `Disputed`. Keep the enum order `None, Open, Accepted, Paid, Refunded`, then append `Cancelled, Disputed`.

- `openJob(uint96 fee, uint64 deadline, uint16 outputBefore, string ogRequestId) returns (uint256 jobId)`: anyone (the payer, usually the society or the Pi) locks `fee` USDC with `safeTransferFrom`. It requires `fee > 0`, a deadline in the future, `outputBefore <= 100`, and `ogRequestId` no longer than 128 bytes. `ogRequestId` is the 0G request ID of the AI decision that flagged the panel as dirty: store it in the job and emit it. Job ids start at 1.
- `accept(uint256 jobId)`: the first cleaner to call it while the job is `Open` and before the deadline gets the job. The payer cannot accept their own job.
- `release(uint256 jobId, uint16 outputAfter, bytes32 proof)`: **oracle only**. Status must be `Accepted` or `Disputed`, it must be at or before the deadline, and `outputAfter` must be between `RELEASE_PCT` (constant 90) and 100. It pays the fee to the cleaner. `proof` is the hash of the signed meter readings that show the clean panel: store it and emit it.
- `cancel(uint256 jobId)`: the payer or the oracle can cancel a job that is still `Open` (nobody accepted it yet, for example because rain cleaned the panel). The full fee goes back to the payer.
- `dispute(uint256 jobId, string reason)`: the cleaner of an `Accepted` job can call it at or before the deadline (for example, "I cleaned it but it is cloudy"). The status becomes `Disputed`, and a disputed job cannot be refunded by the deadline path until `DISPUTE_WINDOW` (constant 3 days) after the deadline. The oracle can still `release` it if the meter sees the panel clean before the deadline.
- `resolve(uint256 jobId, bool payCleaner)`: **owner only** (the committee), only while `Disputed`. It pays the cleaner or refunds the payer.
- `refund(uint256 jobId)`: anyone can call it. It returns the fee to the payer for an `Open` or `Accepted` job after the deadline, or for a `Disputed` job after `deadline + DISPUTE_WINDOW`.
- `linkEpisode(uint256 jobId, bytes32 ogStorageRoot)`: **oracle only**, for any existing job. The 0G Storage upload finishes after the transaction, so this stores the root and emits `EpisodeLinked`. It can only be set once per job.
- Struct `Job`, in this order: `payer, cleaner, fee, deadline, outputBefore, outputAfter, status, proof, ogStorageRoot, ogRequestId`.
- Events: `JobOpened(jobId, payer, fee, deadline, outputBefore, ogRequestId)`, `JobAccepted`, `JobPaid(jobId, cleaner, fee, outputAfter, proof)`, `JobRefunded`, `JobCancelled`, `JobDisputed(jobId, cleaner, reason)`, `DisputeResolved(jobId, paidCleaner)`, `EpisodeLinked(jobId, ogStorageRoot)`. Index `jobId` and the addresses.
- Each status change is final; no state may be entered twice. The contract's USDC balance must always equal the sum of the fees of the unfinished jobs.

## 2. ShopTrade: a nearby shop prepays for spare noon solar, settled by the meter

Keep the draft's logic: `placeOrder(string day, uint32 wantWh, uint64 deadline)` takes `costOf(wantWh)` (rounded up to the next micro-USDC) at the current `pricePerKwh` and fixes the price in the order. `settle(orderId, deliveredWh)` is oracle only. It caps `deliveredWh` at `wantWh`, pays `deliveredWh * price / 1000` (rounded down) to the treasury, and returns the rest to the shop **in the same transaction**. After the deadline, if the order was never settled, the shop can `refund` it. `setPrice` can be called by the owner or the oracle, and must be greater than 0 and at most `10_000_000` (10 USDC per kWh). Also require `wantWh > 0`, a future deadline and a `day` of at most 10 bytes. Constructor: `(usdc_, oracle_, treasury_, pricePerKwh_, owner_)`.

## 3. SolarBilling: the monthly bill per flat, split by where the power came from

Each month the oracle posts each flat's bill from that flat's own meter. **Payment splitting:** the solar part of the bill goes to the society treasury (which owns the panel), and the grid part goes to `gridPayee` (the electricity board's account). Both happen in the single `pay` transaction.

- `postBill(string flat, string month, address resident, uint96 solarAmount, uint96 gridAmount, uint32 solarWh, uint32 gridWh, bytes32 readingsHash) returns (uint256 billId)`: oracle only, once per (flat, month), using `key(flat, month) = keccak256(abi.encode(flat, month))` and `billOf(key)`. If `resident` is 0, anyone may pay.
- `pay(uint256 billId)`: it moves `solarAmount` to the treasury and `gridAmount` to `gridPayee` with `safeTransferFrom` from the payer. A bill can only be paid once, and it must exist.
- Struct `Bill`, in this order: `flat, month, resident, amount (= solar + grid), solarWh, gridWh, readingsHash, paid, paidBy, solarAmount, gridAmount`.
- Constructor: `(usdc_, oracle_, treasury_, gridPayee_, owner_)`. Add an owner-only `setGridPayee(address)`.
- Events: `BillPosted(billId, flat, month, resident, amount, solarWh, gridWh, readingsHash)` and `BillPaid(billId, payer, amount, solarAmount, gridAmount)`.

## Tests

Use Foundry and forge-std, with a 6-decimal `MockUSDC` in `test/` only (never deploy it). Cover every happy path and every revert above, in particular:
- release on a dirty panel (89) fails, while 90 and 100 pay; release from a non-oracle fails; release after the deadline fails
- refund before the deadline fails; a disputed job cannot be refunded inside the dispute window; resolve both ways
- cancel by a stranger fails; a payer cannot accept their own job; a double release or double refund fails
- `linkEpisode` works once, and only from the oracle
- the escrow balance invariant (a fuzz test is welcome)
- the ShopTrade rounding: the deposit is rounded up, the payment is rounded down, and paid + refunded always equals the deposit (fuzz it)
- the SolarBilling split goes to the right two wallets, plus a double pay and a wrong resident

Run `forge test -vv` and show me the summary. List any audit finding you did not fix, and why.
