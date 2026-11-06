#!/usr/bin/env bash
# Deploy EpisodeRegistry to 0G Galileo, verify it on chainscan-galileo and write deployments.json.
#
#   ./deploy.sh path/to/env-file
#
# The env file holds ZG_DEPLOYER_PRIVATE_KEY (and optionally ZG_DEVICE_ADDRESS, the Pi's 0G wallet).
# The key is read by `forge script` from the environment, so it is never printed or put on a command line.
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE="${1:?usage: ./deploy.sh path/to/env-file}"
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
: "${ZG_DEPLOYER_PRIVATE_KEY:?missing in $ENV_FILE}"

RPC="${ZG_RPC:-https://evmrpc-testnet.0g.ai}"
CHAIN_ID=16602
EXPLORER="https://chainscan-galileo.0g.ai"
VERIFIER_URL="$EXPLORER/open/api"

forge build
forge script script/Deploy.s.sol:Deploy --rpc-url "$RPC" --broadcast --slow

RUN="broadcast/Deploy.s.sol/$CHAIN_ID/run-latest.json"
read -r ADDRESS TX DEPLOYER <<<"$(python3 -c '
import json, sys
r = json.load(open(sys.argv[1]))
t = next(t for t in r["transactions"] if t["transactionType"] == "CREATE" and t["contractName"] == "EpisodeRegistry")
print(t["contractAddress"], t["hash"], t["transaction"]["from"])
' "$RUN")"
DEVICE="$(cast call "$ADDRESS" "device()(address)" --rpc-url "$RPC")"
OWNER="$(cast call "$ADDRESS" "owner()(address)" --rpc-url "$RPC")"
BLOCK="$(cast receipt "$TX" blockNumber --rpc-url "$RPC")"
echo "EpisodeRegistry $ADDRESS (tx $TX, block $BLOCK) owner $OWNER device $DEVICE"

# The explorer needs a moment to index the new contract before it accepts the source.
sleep 10
forge verify-contract "$ADDRESS" src/EpisodeRegistry.sol:EpisodeRegistry \
  --chain-id "$CHAIN_ID" \
  --compiler-version 0.8.19 \
  --num-of-optimizations 200 \
  --evm-version cancun \
  --constructor-args "$(cast abi-encode 'constructor(address)' "$DEVICE")" \
  --verifier custom --verifier-url "$VERIFIER_URL" --verifier-api-key PLACEHOLDER \
  --watch || echo "verification did not finish: rerun the forge verify-contract command above"

python3 - "$ADDRESS" "$TX" "$BLOCK" "$OWNER" "$DEVICE" "$EXPLORER" <<'PY'
import json, sys
address, tx, block, owner, device, explorer = sys.argv[1:]
out = {
    "network": "0G Galileo testnet",
    "chainId": 16602,
    "rpc": "https://evmrpc-testnet.0g.ai",
    "EpisodeRegistry": {
        "address": address,
        "deployTx": tx,
        "block": int(block),
        "owner": owner,
        "device": device,
        "explorer": f"{explorer}/address/{address}",
        "compiler": "solc 0.8.19, evm cancun, optimizer 200 runs",
    },
}
json.dump(out, open("deployments.json", "w"), indent=2)
open("deployments.json", "a").write("\n")
print(json.dumps(out, indent=2))
PY
