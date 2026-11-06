Deploy **only `SolarCredits`** to **Arc Testnet** (chain 5042002). Don't redeploy the other three contracts.

1. Run `forge test` first. Deploy only if every suite is green.
2. Constructor arguments, in this order:
   - `usdc_` = `0x3600000000000000000000000000000000000000` (Arc's USDC, 6 decimals)
   - `oracle_` = `0xA2F16C1A2b562349B475046eAb3E9e59B9bD1Ccf` (the building's Pi, the same oracle as the other three)
   - `owner_` = `0x6c11FAcF7DE8C250A3E648aB9F73fBDaFe5563D6` (the society committee, which now owns the other three)
3. Never deploy a mock token.
4. Read back `usdc()`, `oracle()`, `owner()`, `pendingOwner()`, `MAX_FLATS`, `MAX_WH` and `MAX_RATE`, and check they match.
5. Verify the source on the Arc testnet explorer, as you did for the others. If the lookup copies sources into `contracts/imported/`, remove them again.
6. Reply with a table: the address, the deploy transaction, the explorer link and the read-back values.
