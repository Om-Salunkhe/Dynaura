# contracts

Solidity contracts for Arc. They are written here, then **pasted into Arc Studio, deployed from Arc Studio and shown in Studio in the demo** (every Arc prize asks for that).

| Contract | What it does |
|---|---|
| `CleaningEscrow.sol` | Dusty panel → fee locked in USDC → cleaner accepts → the meter releases it when output is back above 90%, or the society gets a refund after the deadline |
| `ShopTrade.sol` | A nearby shop prepays for spare noon solar → after the window the meter settles: society is paid per Wh delivered, the shop gets the rest back in the same tx |
| `SolarBilling.sol` | Each month the meter posts every flat's bill (split by its own meter, with the hash of the signed readings) → the resident pays in USDC straight to the society treasury |

USDC on Arc testnet is the ERC-20 at `0x3600000000000000000000000000000000000000` (6 decimals). Every amount in these contracts is in those 6-decimal units (`2000000` = 2 USDC).

The **oracle** is the Pi's wallet (`ARC_PRIVATE_KEY` in `.env`): it is the only address allowed to release a fee, settle a sale or post a bill, and only from what its own meters measured.

## Check locally (optional)

```bash
cd contracts
npm install
npm run build                       # compiles, writes abi/*.json
pip install "web3>=7" "eth-tester[py-evm]"
python test/test_contracts.py       # runs every rule on an in-memory chain
```

`test/MockUSDC.sol` is only for these tests. Never deploy it to Arc.

## Deploy in Arc Studio

1. Make two wallets (MetaMask is fine) and get testnet USDC for both from the Circle faucet (faucet.circle.com, pick Arc testnet). USDC is also the gas on Arc.
   - **Pi wallet** = oracle. Its key goes in `.env` as `ARC_PRIVATE_KEY`.
   - **Society treasury**: for the demo this can be the same Pi wallet (fees and sales then loop back to it).
2. Open Arc Studio, create a project called **Dynaura**, add the three `.sol` files from this folder (not `test/`).
3. Compile with Solidity 0.8.24 or newer, then deploy each one from Studio with these constructor arguments:

| Contract | Arguments |
|---|---|
| `CleaningEscrow` | `usdc_` = `0x3600000000000000000000000000000000000000`, `oracle_` = Pi wallet |
| `ShopTrade` | `usdc_`, `oracle_` = Pi wallet, `treasury_` = treasury, `pricePerKwh_` = `80000` (0.08 USDC) |
| `SolarBilling` | `usdc_`, `oracle_` = Pi wallet, `treasury_` = treasury |

4. Copy the three addresses and the Studio project link into `deployments.json` (this file is what judges read), into `.env` (`ARC_ESCROW`, `ARC_SHOP`, `ARC_BILLING`) and into `web/.env` (`VITE_ARC_ESCROW`, `VITE_ARC_SHOP`, `VITE_ARC_BILLING`).
5. In the demo video, show the Studio project with the three deployed contracts and one paid escrow.
