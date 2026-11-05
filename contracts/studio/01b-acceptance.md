Our own acceptance tests are now in `test/acceptance/`, together with `test/acceptance/AcceptanceUSDC.sol` (a 6-decimal mock for tests only). We wrote them independently from the same spec. Our Raspberry Pi and React code call the contracts with exactly the names these tests use.

Run `forge test` on everything: your tests and ours. Where an acceptance test fails:

- **If it is a difference in behaviour:** decide which behaviour is correct and safer per the spec, then fix the contract. If you think our test is wrong, say why and leave that test unchanged.
- **If it is only a difference in naming** (custom error names, event names or argument order, or public names like `totalLocked`, `nextJobId`, `RELEASE_PCT`, `DISPUTE_WINDOW`, `MAX_REQUEST_ID_BYTES`, `MAX_PRICE_PER_KWH`, `MAX_DAY_BYTES`, `MAX_LABEL_BYTES`): rename it in the contract to match the tests.
- **If only the import paths fail** (your remappings for forge-std or OpenZeppelin differ): fix just those import lines in the acceptance tests.

Never weaken a check to make a test pass. Keep the max-preset audit standard. Finish with the `forge test -vv` summary (every suite must be green), plus a short list of what you changed in the contracts and why.
