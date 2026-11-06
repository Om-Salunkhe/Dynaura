# Dynaura on Arkiv

> 0G decides, Arc pays, **Arkiv remembers**.

Dynaura's open record book lives on **Arkiv (Rabdi testnet, chain 7794095)**. It holds signed meter
readings, every 0G decision with its proof, shop offers that close at sunset, cleaning jobs backed
by an Arc escrow, bills and sales. A heartbeat's expiry is the building's offline alarm.

| File | What |
|---|---|
| [schema.md](schema.md) | The 9 schemas: indexed columns, lifetimes, what is sealed, how they link to 0G and Arc |
| [how-you-use-arkiv.md](how-you-use-arkiv.md) | Screens ↔ queries, edit rights, expiry, the write path, live transactions, measurements |
| [why-arkiv.md](why-arkiv.md) | What a normal database would lose |
| [friction.md](friction.md) | What got in our way, with reproductions and evidence |
| [reach.md](reach.md) | Who it's for and how people can see it |

## Wallets

| Wallet | Address | Building id |
|---|---|---|
| Building wallet, demo | **TODO:** the address from the Pi bridge's `GET /health` | `sunrise-apartments` |
| Test wallet | [`0xd961a5C42dd84F003Ef3C85a1bD08BE59A8717Cd`](https://rabdi.explorer.arkiv.network/address/0xd961a5C42dd84F003Ef3C85a1bD08BE59A8717Cd) | `test-dyarkiv-1` |

## Try it: one query, no key, no SDK

The building's latest AI decisions, each with its 0G request ID and 0G Storage root. It is the same
query the app's History screen runs, scoped to records the building wallet **created and still
owns**:

```bash
curl -s https://rpc.rabdi.db-chain.testnet.arkiv.network \
  -H 'Content-Type: application/json' --data @- <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":[
  "arkiv.schema = str('dynaura.decision') AND building = str('test-dyarkiv-1') AND $creator = addr(0xd961a5C42dd84F003Ef3C85a1bD08BE59A8717Cd) AND $owner = addr(0xd961a5C42dd84F003Ef3C85a1bD08BE59A8717Cd) ORDER BY decision_id:u64 DESC",
  {"select":{"key":true,"expiresAt":true,"attributes":{"kind":true,"day":true,"og_request_id":true,"og_storage_root":true}},"limit":"0x3"}]}
EOF
```

Tested on 6 Nov 2026 against the public endpoint (rate limited, but fine for one query): it returns
3 decisions. `expiresAt` is the block each one disappears at.

**Is the building online?** Ask for its heartbeat. **An empty `data` array means offline:** the
Pi stopped renewing the heartbeat and Arkiv let it expire.

```bash
curl -s https://rpc.rabdi.db-chain.testnet.arkiv.network \
  -H 'Content-Type: application/json' --data @- <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":[
  "arkiv.schema = str('dynaura.heartbeat') AND building = str('test-dyarkiv-1') AND $creator = addr(0xd961a5C42dd84F003Ef3C85a1bD08BE59A8717Cd) AND $owner = addr(0xd961a5C42dd84F003Ef3C85a1bD08BE59A8717Cd) ORDER BY updated:u64 DESC",
  {"select":{"expiresAt":true,"attributes":{"mode":true,"flats":true,"updated":true}},"limit":"0x1"}]}
EOF
```

For the demo building, replace `test-dyarkiv-1` with `sunrise-apartments` and the address with the
demo building wallet above.

## Run it yourself

```bash
cd bridge && npm ci
npm test                                        # writer failure paths, offline (11 tests)
BUILDING_ID=test-<you>-1 npm start              # needs ARKIV_PRIVATE_KEY + ARKIV_ACCESS_KEY in ../.env
npm run smoke                                   # live: writes every schema, reads it back like the app (36 checks)
BUILDING_ID=test-<you>-1 node --env-file=../.env trust-check.mjs   # live: why reads scope by creator
```

`npm run smoke` reads with the web app's own query code, so run `npm ci` in `web/` first.
