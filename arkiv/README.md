# Dynaura on Arkiv

> 0G decides, Arc pays, **Arkiv remembers**.

Dynaura's open record book lives on **Arkiv (Rabdi testnet, chain 7794095)**. It holds:
- signed meter readings
- every 0G decision with its proof
- cleaning requests from 0G's flag to the cleaner's payout
- shop offers that close at sunset
- bills and sales

The building's heartbeat expiring is its offline alarm.

| File | What |
|---|---|
| [schema.md](schema.md) | The 9 schemas: indexed columns, lifetimes, what is sealed, how they link to 0G and Arc |
| [how-you-use-arkiv.md](how-you-use-arkiv.md) | Screens ↔ queries, edit rights, expiry, the write path, live transactions, measurements |
| [why-arkiv.md](why-arkiv.md) | What a normal database would lose, and what we kept off Arkiv |
| [friction.md](friction.md) | What got in our way, with reproductions and evidence |
| [reach.md](reach.md) | Who it's for, whether they'd use it, how to try it today, what's next |

## The building wallet

| Building | Wallet (writes every record) |
|---|---|
| `sunrise-apartments` (the live demo building) | [`0xd961a5C42dd84F003Ef3C85a1bD08BE59A8717Cd`](https://rabdi.explorer.arkiv.network/address/0xd961a5C42dd84F003Ef3C85a1bD08BE59A8717Cd) |

The same wallet also wrote our live test runs under the building id `test-dyarkiv-1`. Every query
below filters by building id, so the two never mix.

## Try it: no SDK needed

**The building's latest AI decisions.** Each comes with its 0G request ID and 0G Storage root. This
is the same query the app's History screen runs, scoped to records the building wallet **created
and still owns**:

```bash
curl -s https://rpc.rabdi.db-chain.testnet.arkiv.network \
  -H 'Content-Type: application/json' --data @- <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":[
  "arkiv.schema = str('dynaura.decision') AND building = str('sunrise-apartments') AND $creator = addr(0xd961a5C42dd84F003Ef3C85a1bD08BE59A8717Cd) AND $owner = addr(0xd961a5C42dd84F003Ef3C85a1bD08BE59A8717Cd) ORDER BY decision_id:u64 DESC",
  {"select":{"key":true,"expiresAt":true,"attributes":{"kind":true,"mode":true,"day":true,"og_request_id":true,"og_storage_root":true}},"limit":"0x5"}]}
EOF
```

**The panel's last three signed readings.** Each is a 1-minute summary signed by the Pi's device
key. These are what a cleaning payout's proof hash is computed from:

```bash
curl -s https://rpc.rabdi.db-chain.testnet.arkiv.network \
  -H 'Content-Type: application/json' --data @- <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":[
  "arkiv.schema = str('dynaura.reading') AND building = str('sunrise-apartments') AND meter = str('panel') AND $creator = addr(0xd961a5C42dd84F003Ef3C85a1bD08BE59A8717Cd) AND $owner = addr(0xd961a5C42dd84F003Ef3C85a1bD08BE59A8717Cd) ORDER BY minute:u64 DESC",
  {"select":{"key":true,"expiresAt":true,"attributes":{"minute":true,"avg_w":true,"wh":true,"signer":true,"sig":true}},"limit":"0x3"}]}
EOF
```

**Is the building online?** Ask for its heartbeat. **An empty `data` array means offline:** the Pi
stopped renewing the heartbeat, so Arkiv let it expire.

```bash
curl -s https://rpc.rabdi.db-chain.testnet.arkiv.network \
  -H 'Content-Type: application/json' --data @- <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":[
  "arkiv.schema = str('dynaura.heartbeat') AND building = str('sunrise-apartments') AND $creator = addr(0xd961a5C42dd84F003Ef3C85a1bD08BE59A8717Cd) AND $owner = addr(0xd961a5C42dd84F003Ef3C85a1bD08BE59A8717Cd) ORDER BY updated:u64 DESC",
  {"select":{"expiresAt":true,"attributes":{"mode":true,"flats":true,"updated":true}},"limit":"0x1"}]}
EOF
```

`expiresAt` is the block each record disappears at; blocks are 2 seconds apart.

**Checked 6 Nov 2026, 22:30 IST:** the live building had 76 panel and flat readings, its daily totals,
and a decision. That decision is the no-AI safe stop the Pi logged while the 0G Router was down.
The heartbeat query was empty because the Pi was switched off for the night.

**If you get `ANON_COST_LIMITED` (429):** the public endpoint's anonymous budget is used up (see
[friction #9](friction.md)). Add a free key from
[hub.arkiv.network/access-keys](https://hub.arkiv.network/access-keys) as the last part of the URL:
`https://rpc.rabdi.db-chain.testnet.arkiv.network/<your-key>`.

## Run it yourself

```bash
cd bridge && npm ci
npm test                                        # writer + cleaning-job payload, offline (15 tests)
BUILDING_ID=test-<you>-1 npm start              # needs ARKIV_PRIVATE_KEY + ARKIV_ACCESS_KEY in ../.env
npm run smoke                                   # live: writes every schema, reads it back like the app
BUILDING_ID=test-<you>-1 node --env-file=../.env trust-check.mjs   # live: why reads scope by creator
```

`npm run smoke` reads with the web app's own query code, so run `npm ci` in `web/` first. Use a
wallet of your own for this: two bridges writing with one wallet race each other for nonces.
