Add a fourth contract to this project: **`contracts/SolarCredits.sol`**. Leave `CleaningEscrow`, `ShopTrade` and `SolarBilling` exactly as they are: they are deployed and live. Don't deploy anything in this turn.

## What it is for

A building's rooftop panel is shared by its flats. Each flat has a fair share of each day's sun. Some flats use less than their share; that **spare** sun is sold to a neighbour flat that needs more than its share, to a nearby shop, or exported to the grid. Today that revenue is split equally between the flats. **SolarCredits pays each flat by how much of its share it left unused**: `claim = pool × unusedWh[flat] / Σ unusedWh`, computed on chain. The building's Raspberry Pi meters the flats, works out each flat's unused and over-share energy for a period (a day or a month), and posts it. It is reusable as "pay contributors in proportion to a measured contribution".

## Roles
- **USDC** on Arc testnet: `0x3600000000000000000000000000000000000000` (ERC-20, 6 decimals).
- **Oracle**: the building's Pi. Only it can post a period.
- **Owner**: the society committee, with `Ownable2Step` and renounce disabled, like the other three contracts. It registers each flat's wallet and can change the oracle.
- Constructor: `constructor(address usdc_, address oracle_, address owner_)`. All three must be non-zero.

## Units
- Energy is in **Wh of the real building** (`uint256`). Each flat's value is capped at `MAX_WH = 1e12`.
- `neighborRate` is in **micro-USDC per Wh**: 13 means 0.013 USDC per kWh. Cap it at `MAX_RATE = 1_000_000`.

## Functions (keep these exact names and argument orders: our Raspberry Pi and React app call them)
- `postPeriod(bytes32 periodId, string[] flats, uint256[] unusedWh, uint256[] overWh, uint256 neighborRate, bytes32 readingsHash)`. **Oracle only.**
  - A period is posted **once** and is then immutable.
  - Rejected: a zero `periodId`, no flats, more than `MAX_FLATS = 16`, length mismatches, a duplicate flat, an empty label or one over `MAX_LABEL_BYTES = 16`, values over the caps, and a flat with **both** unused and over above 0 (a flat is either under its share or over it).
  - `readingsHash` is the hash of the Pi's signed meter readings behind the numbers; store it and emit it.
- `register(string flat, address wallet)`. **Owner only.** The wallet must be non-zero. It can be changed later; a claim pays whoever is registered when the claim is made.
- `fund(bytes32 periodId, uint256 amount)`. **Anyone**: shop and grid revenue goes into the period's pool. Requires a posted period, `amount > 0` and `Σ unusedWh > 0` (otherwise nobody can ever claim it and the money would be stuck).
- `payIn(bytes32 periodId, string flat)`. **Anyone** (normally the buyer flat's wallet). It pays exactly `overWh[flat] × neighborRate` into the pool, **once per flat per period**. Only for a flat in the period with `overWh > 0`, and only if `Σ unusedWh > 0`.
- `claim(bytes32 periodId, string flat)`. **Anyone** may trigger it, but the USDC always goes to the flat's **registered wallet** (revert if none is registered). It pays what the flat is still owed: `totalIn × unusedWh[flat] / Σ unusedWh − alreadyClaimed[flat]` (round down; use `Math.mulDiv`). Revert when that is 0. Claiming again later pays only the share of money that arrived since. Nothing is ever paid twice.
- Views:
  - `claimable(bytes32 periodId, string flat) returns (uint256)`
  - `walletOf(string flat) returns (address)`
  - `periodInfo(bytes32 periodId) returns (bool posted, uint256 neighborRate, bytes32 readingsHash, uint256 totalUnusedWh, uint256 totalIn, uint256 totalClaimed)`
  - `flatInfo(bytes32 periodId, string flat) returns (bool inPeriod, uint256 unusedWh, uint256 overWh, bool paidIn, uint256 claimed)`
  - `flatsOf(bytes32 periodId) returns (string[])`
  - `setOracle(address)` (owner), `oracle()`, `usdc()`, `owner()`
- Events: one for every state change. Please use exactly:
  - `PeriodPosted(bytes32 indexed periodId, string[] flats, uint256[] unusedWh, uint256[] overWh, uint256 neighborRate, bytes32 readingsHash)`
  - `FlatRegistered(string flat, address indexed wallet)`
  - `PeriodFunded(bytes32 indexed periodId, address indexed from, uint256 amount)`
  - `NeighborPaid(bytes32 indexed periodId, string flat, address indexed payer, uint256 overWh, uint256 amount)`
  - `CreditClaimed(bytes32 indexed periodId, string flat, address indexed wallet, uint256 amount)`
  - `OracleChanged(address oracle)`

## Our acceptance tests
They are in `contracts/test/acceptance/SolarCredits.t.sol`, which uses the existing `AcceptanceUSDC`. We wrote them from this spec before any code existed, including Pawan's numbers: A saved 30 kWh, B saved 10 kWh, and C bought 20 kWh, so **A gets 3× B**. They must pass **unchanged**. If you believe one is wrong, say why and leave it as it is.

## Standard
- **Same as the other three contracts:** SafeERC20, `nonReentrant` on every function that moves USDC, checks-effects-interactions, custom errors, no `payable`, max-preset audit.
- **Your own tests:** Foundry tests for every revert and event, a fuzz test of the split, and an invariant test that the USDC the contract holds is always at least `Σ (totalIn − totalClaimed)`.
- **Finish with:** the `forge test -vv` summary (every suite green, the old ones included) and a short list of anything you added beyond this spec.
