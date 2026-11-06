Deploy the three contracts from this project to **Arc Testnet** (chain 5042002). Don't deploy `MockUSDC`. First run `forge test` again and stop if anything fails.

Constructor arguments:

| Contract | Arguments |
|---|---|
| `CleaningEscrow` | `usdc_` = `0x3600000000000000000000000000000000000000`, `oracle_` = `0xA2F16C1A2b562349B475046eAb3E9e59B9bD1Ccf`, `owner_` = `0xA2F16C1A2b562349B475046eAb3E9e59B9bD1Ccf` |
| `ShopTrade` | `usdc_` = `0x3600000000000000000000000000000000000000`, `oracle_` = `0xA2F16C1A2b562349B475046eAb3E9e59B9bD1Ccf`, `treasury_` = `0xA2F16C1A2b562349B475046eAb3E9e59B9bD1Ccf`, `pricePerKwh_` = `80000`, `owner_` = `0xA2F16C1A2b562349B475046eAb3E9e59B9bD1Ccf` |
| `SolarBilling` | `usdc_` = `0x3600000000000000000000000000000000000000`, `oracle_` = `0xA2F16C1A2b562349B475046eAb3E9e59B9bD1Ccf`, `treasury_` = `0xA2F16C1A2b562349B475046eAb3E9e59B9bD1Ccf`, `gridPayee_` = `0x69E52f183FE1D423Da95619986a648194cbFF140`, `owner_` = `0xA2F16C1A2b562349B475046eAb3E9e59B9bD1Ccf` |

`0xA2F1…1Ccf` is the building's Pi wallet: it is the oracle and, for the demo, the committee and treasury too. `0x69E5…F140` stands in for the electricity board.

After deploying, read back from each contract `usdc()`, `oracle()`, `owner()`, plus `treasury()`, `pricePerKwh()` and `gridPayee()` where they exist, and confirm they match the table. Verify the source on the Arc testnet explorer if you can. Then list each contract's address, deploy transaction hash and explorer link.
