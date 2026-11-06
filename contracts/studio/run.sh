#!/usr/bin/env bash
# Runs Dynaura's Arc Studio turns one step at a time (see ../STUDIO.md).
#
#   contracts/studio/run.sh whoami    check the CLI is logged in
#   contracts/studio/run.sh build     01: Studio writes + tests the 3 contracts from our spec (drafts as context)
#   contracts/studio/run.sh accept    01b: our 50 Foundry tests go in as acceptance tests; Studio makes them pass
#   contracts/studio/run.sh pull      pull Studio's contracts + tests into studio/out/pulled and diff against src/
#   contracts/studio/run.sh deploy    02: Studio deploys the 3 contracts to Arc testnet
#   contracts/studio/run.sh console   03: Studio builds the escrow console frontend in the same app
#   contracts/studio/run.sh status    deployments + workspace URL
#
# Each turn's result document is saved to studio/out/<step>.json (stderr progress in <step>.log).
# A contract turn takes 5-20 minutes. Don't kill it: closing the connection cancels the turn.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"        # contracts/studio
REPO="$(cd "$HERE/../.." && pwd)"
AS="${ARC_STUDIO_BIN:-arc-studio}"
SESSION="${ARC_STUDIO_SESSION:-dynaura}"
OUT="$HERE/out"
mkdir -p "$OUT"

summary() { # print the parts of a result document a human needs (prose is Studio's, not attested)
  python3 -I - "$1" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception as e:
    sys.exit(f"no result document ({e}); see the .log next to it")
print("status:     ", d.get("status"), "|", d.get("errorMessage") or "")
print("app:        ", d.get("appId"), "|", d.get("webUrl"))
print("files:      ", ", ".join(d.get("filesChanged") or []) or "-")
for x in d.get("deployments") or []:
    print("deployed:   ", x.get("contract"), x.get("address"), x.get("network"), x.get("txHash"))
if d.get("questions"):
    print("QUESTIONS:  ", json.dumps(d["questions"], indent=1)[:3000])
if d.get("budget"):
    print("BUDGET:     ", d["budget"])
print("\n--- Studio's summary (model output, verify against the files) ---")
print((d.get("finalText") or "")[:4000])
PY
}

turn() { # step prompt-file [--file ...]
  local step=$1 prompt=$2; shift 2
  echo "[$step] running (5-20 min)... progress in $OUT/$step.log"
  set +e
  "$AS" run --session "$SESSION" --prompt-file "$prompt" --output json "$@" >"$OUT/$step.json" 2>"$OUT/$step.log"
  local code=$?
  set -e
  echo "[$step] exit $code (0 completed, 3 needs input, 4 budget, 1 error)"
  summary "$OUT/$step.json"
  return 0
}

case "${1:-}" in
  whoami)
    "$AS" whoami ;;
  build)
    # Om's first drafts (on main) go in as read-only context; the spec is the prompt.
    rm -rf "$OUT/drafts" && mkdir -p "$OUT/drafts"
    for c in CleaningEscrow ShopTrade SolarBilling; do
      git -C "$REPO" show "57207f2:contracts/$c.sol" >"$OUT/drafts/$c.sol"
    done
    (cd "$OUT/drafts" && turn build "$HERE/01-build-and-test.md" \
      --file CleaningEscrow.sol --file ShopTrade.sol --file SolarBilling.sol) ;;
  accept)
    # Our tests, with import paths for Studio's layout (sources in contracts/, tests in contracts/test/).
    rm -rf "$OUT/stage" && mkdir -p "$OUT/stage"
    for t in CleaningEscrow ShopTrade SolarBilling; do
      sed -e 's|"\.\./src/|"../../|' -e 's|MockUSDC|AcceptanceUSDC|g' "$HERE/../test/$t.t.sol" >"$OUT/stage/$t.t.sol"
    done
    sed -e 's|contract MockUSDC|contract AcceptanceUSDC|' "$HERE/../test/MockUSDC.sol" >"$OUT/stage/AcceptanceUSDC.sol"
    (cd "$OUT/stage" && turn accept "$HERE/01b-acceptance.md" \
      --file CleaningEscrow.t.sol:contracts/test/acceptance/ --file ShopTrade.t.sol:contracts/test/acceptance/ \
      --file SolarBilling.t.sol:contracts/test/acceptance/ --file AcceptanceUSDC.sol:contracts/test/acceptance/) ;;
  pull)
    rm -rf "$OUT/pulled"
    "$AS" pull --session "$SESSION" --out "$OUT/pulled" --paths "contracts/*.sol" "contracts/test/**" "foundry.toml" "remappings.txt" "README.md"
    for c in CleaningEscrow ShopTrade SolarBilling; do
      f="$OUT/pulled/contracts/$c.sol"; [ -f "$f" ] || f=""
      if [ -z "$f" ]; then echo "missing $c.sol in Studio's workspace"; continue; fi
      echo "=== $c: Studio vs src/ ==="
      diff -u "$HERE/../src/$c.sol" "$f" | head -400 || true
    done ;;
  deploy)
    turn deploy "$HERE/02-deploy.md" ;;
  console)
    turn console "$HERE/03-console.md" ;;
  status)
    "$AS" deployments --session "$SESSION" --json || true
    "$AS" apps --json | python3 -I -c "import json,sys; [print(a.get('id'), a.get('name'), a.get('updatedAt','')) for a in json.load(sys.stdin)]" || true ;;
  *)
    sed -n '2,13p' "$0"; exit 1 ;;
esac
