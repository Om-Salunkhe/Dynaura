# Dynaura

AI-run shared solar for apartment buildings.

A Raspberry Pi meters every flat and the rooftop panel. **Dyna**, an AI planner running on **0G**, plans tomorrow's pumps and chargers around the sun. **Arc** USDC splits the bills and pays the panel cleaner only when the panel proves it is clean. **Arkiv** keeps an open record book with entries that expire on their own.

> 0G decides, Arc pays, Arkiv remembers.

Built from scratch at ETHGlobal Mumbai 2026 by Om Salunkhe and Devang Gandhi.

## Getting started

```bash
git clone https://github.com/Om-Salunkhe/Dynaura.git
cd Dynaura
```

Copy `.env.example` to `.env` and fill in your values before running the project.

## Arkiv

Records live on Arkiv's Rabdi testnet (chain 7794095), written by one building wallet and read by
the app straight from the browser. Schemas, judging notes and more queries are in [`arkiv/`](arkiv/README.md).

- Building wallet (demo, `sunrise-apartments`): **TODO** address from the Pi bridge's `/health`
- Test wallet (`test-dyarkiv-1`): [`0xd961a5C42dd84F003Ef3C85a1bD08BE59A8717Cd`](https://rabdi.explorer.arkiv.network/address/0xd961a5C42dd84F003Ef3C85a1bD08BE59A8717Cd)

The building's latest AI decisions, with their 0G proofs (no key or SDK needed):

```bash
curl -s https://rpc.rabdi.db-chain.testnet.arkiv.network \
  -H 'Content-Type: application/json' --data @- <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":[
  "arkiv.schema = str('dynaura.decision') AND building = str('test-dyarkiv-1') AND $creator = addr(0xd961a5C42dd84F003Ef3C85a1bD08BE59A8717Cd) AND $owner = addr(0xd961a5C42dd84F003Ef3C85a1bD08BE59A8717Cd) ORDER BY decision_id:u64 DESC",
  {"select":{"key":true,"expiresAt":true,"attributes":{"kind":true,"day":true,"request_id":true,"storage_root":true}},"limit":"0x3"}]}
EOF
```

## Status

Work in progress. See the commit history.
