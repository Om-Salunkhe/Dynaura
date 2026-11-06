# Arc Studio: how Dynaura's contracts are built, tested and deployed

Every Arc prize requires Arc Studio as the starting point. Our contracts are generated, tested (Foundry) and deployed **inside an Arc Studio project**, and the copies in this folder are pulled back from that project.

## What Arc Studio is (checked 6 Nov 2026)

- **Web workspace:** https://studio.arc.io. (The prize page links `studio.arc.com`, but the official CLI only accepts `studio.arc.io`.) A project is an "app" with chat, code and a live preview, at `https://studio.arc.io/app/<appId>`.
- **What it runs on:** a hosted agent working in its own server-side sandbox, which is a **Vite + Foundry** app (Solidity in `contracts/`, web code in `src/`). It writes, audits, tests and deploys contracts. The "max preset" means a full audit plus tests. Source: https://studio.arc.io/llms.txt
- **Deploys:** "one-click deploys on Arc Testnet" (and 8 other testnets) **from Studio's own wallet**, never to mainnet. Because Studio's wallet becomes `msg.sender`, every constructor of ours takes an explicit `owner_`.
- **Official CLI:** `@circle-fin/arc-studio-cli` (bin `arc-studio`, v1.2.2, published by Circle). It drives the same projects from a terminal or from an AI coding agent:
  - `run "<prompt>" --file … --session … --output json` runs one agent turn.
  - `pull` brings the sandbox files back into this repo.
  - `deployments --json` lists what Studio deployed.
  - `open` opens the web workspace.
  - Prompts are capped at 10,000 characters, and longer context goes in with `--file` (a read-only copy in `context/`, or `src:dest` to place a file in the workspace to be edited in place).
- **Login:** `arc-studio login` is a browser device-link flow, and a human has to click **Authorize**. The token is stored in the macOS Keychain, or with `login --paste` in `~/.arc-studio/credentials.json` (0600).

## Arc testnet facts we rely on

Checked against the live RPC and https://docs.arc.io:

| | |
|---|---|
| Chain ID | `5042002` |
| RPC | `https://rpc.testnet.arc.io` |
| Explorer | `https://explorer.testnet.arc.io` |
| USDC | ERC-20 `0x3600000000000000000000000000000000000000`, **6 decimals**. It is also the gas token natively, with 18 decimals, so never mix the two. |
| Gas | The minimum base fee is **20 gwei**. A transaction with `maxFeePerGas` under 20 gwei is *silently dropped*. |
| Faucet | https://faucet.circle.com gives 20 USDC per address every 2 hours. It needs a reCAPTCHA and no account. |

## Our flow (the prompts are in `studio/`, the steps in `studio/run.sh`)

1. **`build`:** `01-build-and-test.md` has Studio write CleaningEscrow, ShopTrade and SolarBilling from our spec, using the first drafts as read-only context. It writes Foundry tests and runs them, without deploying.
2. **`accept`:** our own 50 Foundry tests (`test/*.t.sol`), written independently from the same spec, go into the Studio workspace as acceptance tests (`01b-acceptance.md`). Studio must make every suite pass without weakening any check.
3. **`pull`:** Studio's contracts and tests come back to `studio/out/pulled` and are diffed against `src/`. We review them (SafeERC20, `nonReentrant`, the oracle = the Pi wallet, no `payable`, 6-decimal USDC). Any fix goes **back through Studio**, so the code Studio deploys is the code in `src/`.
4. **`deploy`:** `02-deploy.md` deploys all three to Arc testnet with the constructor arguments and reads them back.
5. **`console`:** `03-console.md` has Studio build a small escrow console as the app's own frontend, connected to the deployed contract. Our main app (`web/`) uses the same addresses.
6. `scripts/e2e.py` then runs the escrow and a split bill on Arc testnet against those addresses and saves the transaction links.

```bash
contracts/studio/run.sh whoami
contracts/studio/run.sh build      # 5-20 min per turn; don't interrupt it (that cancels the turn)
contracts/studio/run.sh accept
contracts/studio/run.sh pull
contracts/studio/run.sh deploy
contracts/studio/run.sh console
contracts/studio/run.sh status     # deployments + app URL
```

Each turn's result document goes to `studio/out/<step>.json`, which is ignored by git.

## Human steps (Pawan, about 5 minutes in the browser)

1. **Studio account.** Open https://studio.arc.io and sign in with the account that should own the project (its URL goes in the submission).
2. **Connect the CLI** (pick one):
   - Tell `dy-arc` you're ready. It runs `arc-studio login`, a studio.arc.io tab opens, and you click **Authorize**.
   - Or, in your own terminal, run `arc-studio login --paste` (install it first with `npm install -g @circle-fin/arc-studio-cli`), click **Authorize**, then paste the token into the terminal.
3. **Faucet.** On https://faucet.circle.com:
   1. Pick Arc Testnet and USDC.
   2. Paste the Pi/oracle test wallet, `0xA2F16C1A2b562349B475046eAb3E9e59B9bD1Ccf`.
   3. Solve the reCAPTCHA and send.
   4. Optionally, do the same for the test cleaner, `0x390E8E1242a0f87C09549BE7829B8D6D0a839f4F`. If you skip it, `dy-arc` sends the cleaner a little USDC from the oracle wallet.
4. **Your MetaMask** (for clicking as resident, cleaner or shop in the live demo): fund your own address from the same faucet. The web app adds Arc testnet to MetaMask by itself.
5. **Demo video.** Open the Studio project URL (`dy-arc` sends it) and record the chat where the contracts were generated, the `forge test` run, and the deployed addresses.

## What happened in Studio (Fri 6 Nov)

Project: https://studio.arc.io/app/63db67fa-4bd2-4ba1-a1c5-e7740437e852 (you need to be signed in to view it).

1. **`build`:**
   - Studio wrote all three contracts from `01-build-and-test.md`, using our first drafts as read-only context.
   - It ran three rounds of security and functional review, plus static analysis. No High or Medium findings were left except one (see below).
   - It wrote 161 Foundry tests, including fuzz tests and an escrow invariant test, and all passed.
   - It added things we hadn't asked for: two-step ownership with renounce disabled, and a claim fallback so a frozen payee wallet can't block a job.
2. **`accept`:**
   - Our 50 tests went in under `contracts/test/acceptance/`.
   - Studio renamed errors and events to match them (our app calls those names). It also tightened behaviour: the oracle **and** the committee can no longer accept a cleaning job, an output above 100 is rejected, and an empty `day` is refused.
   - It didn't touch our tests. Result: **211/211 green**, re-checked locally with `forge test`.
3. **Open findings Studio reported, and our answer:**
   - **The shop price can be front-run by the owner or oracle.** Our web app approves only the exact quoted USDC, so a price jump makes the order revert.
   - **The oracle can still release a disputed job when the meter reads clean.** This is intended: the sun settles it.
   - **A cleaner can accept a job and never clean it.** The payer is refunded at the deadline, so no funds are lost.
4. **Pulled back:** `src/*.sol` is byte-identical to Studio's `contracts/*.sol`, and `test/` holds Studio's tests plus `test/acceptance/`. Only the import paths differ, because our sources live in `src/`.
5. **`deploy`:**
   - Studio re-ran the 211 tests and deployed all three contracts to Arc testnet. The deploy came from its Circle smart wallet `0x5b12…ef42`, through ERC-4337, with gas sponsored by a paymaster.
   - It read every constructor setting back and verified the source on the explorer.
   - We checked all of this on-chain ourselves. The runtime bytecode equals a local build of `src/`; only the metadata hash differs. See `deployments.json`.
6. **`console`:**
   - Studio built the app's frontend: a one-page escrow console with the jobs list, the actions each wallet is allowed (accept, dispute, cancel, refund) and a live event feed. The code is pulled into `studio/console/`.
   - Studio found that Arc's RPC rejects `eth_getLogs` filtered by several event topics, so the console fetches raw logs and decodes them in the browser.
   - **Public link:** the Studio project itself needs a Circle login. The Studio-built app can be published for free: in the workspace, open **Integrations** in the workbench header (or the **+** menu in the chat toolbar), connect Vercel, Netlify or Hugging Face, then ask Studio to "deploy this".
