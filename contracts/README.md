# contracts

Solidity contracts for Arc. They are written here, then **pasted into Arc Studio, deployed from Arc Studio and shown in Studio in the demo** (every Arc prize asks for that).

| Contract | What it does |
|---|---|
| `CleaningEscrow.sol` | Dusty panel → fee locked in USDC → cleaner accepts → the meter releases it when output is back above 90%, or the society gets a refund after the deadline |
| `ShopTrade.sol` | A nearby shop prepays for spare noon solar → after the window the meter settles: society is paid per Wh delivered, the shop gets the rest back in the same tx |

USDC on Arc testnet is the ERC-20 at `0x3600000000000000000000000000000000000000` (6 decimals). Every amount in these contracts is in those 6-decimal units (`2000000` = 2 USDC).

The **oracle** is the Pi's wallet (`ARC_PRIVATE_KEY` in `.env`): it is the only address allowed to release a fee or settle a sale, and only from what its own meters measured.

## Check locally (optional)

```bash
cd contracts
npm install
npm run build                       # compiles, writes abi/*.json
pip install "web3>=7" "eth-tester[py-evm]"
python test/test_contracts.py       # runs every rule on an in-memory chain
```

`test/MockUSDC.sol` is only for these tests. Never deploy it to Arc.
