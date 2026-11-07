# zerog

Dynaura's contract on **0G Chain** (Galileo testnet, chain ID 16602): `EpisodeRegistry`, the on-chain index of every decision Dyna makes.

## What it does

Each time Dyna decides something (the day's plan, an "Ask Dyna" answer, a dust check, or a no-AI safe stop), the Pi:

1. writes an **episode log** (JSON) to `pi/episodes/`,
2. uploads it to **0G Storage** and gets its root hash,
3. calls `EpisodeRegistry.record(root, chatId, ai)` from its 0G wallet.

| Field | Meaning |
|---|---|
| `root` | 0G Storage root of the episode JSON. Look it up on [storagescan-galileo](https://storagescan-galileo.0g.ai) |
| `chatId` | 0G Compute request ID (the Router's `ZG-Res-Key`) of the call that made the decision. Empty for a no-AI episode |
| `ai` | `true` if 0G made the decision, `false` for a safe stop when 0G could not be reached. Nothing is faked |

The contract emits `Episode(n, root, chatId, ai)` and numbers episodes from 1. Only the building's Pi (`device`) can record. The `owner` can move that role to a new Pi wallet with `setDevice`. `episodeOf(root)` returns an episode's number, or 0 if that root was never recorded. The same root can't be recorded twice, so the Pi can retry safely after a network failure.

## What an episode log holds

`pi/og_storage.py` writes one JSON per decision:

- the decision (kind, mode `ai` / `no-ai` / `meter`, summary, input, output)
- `zg`: the 0G Compute proof: request ID, model, provider, `tee_verified`, latency
- `building`: the meters, each flat's relay (solar or grid) and the pump at that moment
- `prev`: the decision ID, sha256 and storage root of the episode before it, so the logs form a chain and a missing or edited one shows up

If 0G Storage or the internet is down, the file waits in `pi/episodes/` and is retried with backoff. Once 0G is reachable again the waiting logs upload by themselves, or straight away with `POST /api/admin/episodes/retry`. `GET /api/episodes` shows the queue.

## Check it yourself

On [chainscan-galileo](https://chainscan-galileo.0g.ai), open the contract address below, then:

- **Events**: one `Episode` per decision, in order.
- **Read Contract → `episodeOf(root)`**: paste a storage root from the app's History page to see its episode number.

Or from a terminal:

```bash
cast call <address> "count()(uint256)" --rpc-url https://evmrpc-testnet.0g.ai
cast call <address> "episodeOf(bytes32)(uint256)" <root> --rpc-url https://evmrpc-testnet.0g.ai
```

## Deployment

| | |
|---|---|
| Network | 0G Galileo testnet (chain ID 16602) |
| EpisodeRegistry | [`0xb62f4531f035d5cd188799d96bac553b5d7da984`](https://chainscan-galileo.0g.ai/address/0xb62f4531f035d5cd188799d96bac553b5d7da984) (source verified on chainscan-galileo) |
| Deploy tx | [`0xd1337649…a568`](https://chainscan-galileo.0g.ai/tx/0xd1337649a30e4cf939fcfd0292930fceff2e287a987132c4984f501c02eaa568), block 64198274 |
| Device (the only wallet that may `record`) | the Pi's 0G wallet [`0x79ba0907fF3810100fD3C6002636B30aD8828274`](https://chainscan-galileo.0g.ai/address/0x79ba0907fF3810100fD3C6002636B30aD8828274), which also pays the Storage uploads |
| Episodes recorded | 88 by Sat 7 Nov morning (`count()` on the contract), AI and no-AI alike |

The owner, device and compiler settings are in `deployments.json` (written by `deploy.sh`).

## Build, test, deploy

Needs [Foundry](https://getfoundry.sh). The settings follow 0G's deploy guide: Solidity 0.8.19 with `evm_version = "cancun"`.

```bash
cd zerog
forge test                      # 8 tests, no network
./deploy.sh path/to/env-file    # deploy, verify on chainscan-galileo, write deployments.json
```

The env file holds `ZG_DEPLOYER_PRIVATE_KEY` (the deployer becomes the owner and needs a little Galileo 0G from [faucet.0g.ai](https://faucet.0g.ai)). It can also set `ZG_DEVICE_ADDRESS`, the Pi's 0G wallet; that defaults to the deployer. The key is read from the environment inside `forge script`, so it never appears on a command line.

To hand recording to the Pi later, add `ZG_REGISTRY` and `ZG_DEVICE_ADDRESS` to the env file and run:

```bash
(set -a; . path/to/env-file; set +a; forge script script/SetDevice.s.sol:SetDevice --rpc-url https://evmrpc-testnet.0g.ai --broadcast)
```

## On the Pi

In `.env`, set `ZG_REGISTRY=<address>`. The Pi records from the same wallet that pays for 0G Storage (`ZG_PRIVATE_KEY`), so that wallet's address must be the registry's `device`. If `ZG_REGISTRY` is empty, the Pi still uploads episode logs and just skips the on-chain index.
