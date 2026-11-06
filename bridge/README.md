# bridge

Small Node 22+ service that writes Dynaura records to **Arkiv** (Rabdi testnet) with
`@arkiv-network/sdk` 1.0.1. The Pi's Python code posts JSON to it on `127.0.0.1:5100`; nothing else
can reach it. It is the building wallet's **only** writer.

```
cd bridge
npm ci
npm start          # reads ../.env
curl http://127.0.0.1:5100/health
```

Needs in the root `.env`:

- `ARKIV_PRIVATE_KEY`: the building wallet (owns every record). Fund it with tGLM at https://hub.arkiv.network/faucet.
  About 1 tGLM covers a full day of 1-minute readings and 30-second heartbeats.
- `ARKIV_ACCESS_KEY`: a free key from https://hub.arkiv.network/access-keys (the public endpoint is rate limited)
- `BUILDING_ID`: `sunrise-apartments` for the demo; use `test-<you>-<n>` when testing

Optional: `ARKIV_BRIDGE_PORT` (5100), `ARKIV_MAX_QUEUE` (200), `ARKIV_KEEP_MARGIN_DAYS` (30),
`ARKIV_RPC_URL` (a **local** node only; a Rabdi URL is ignored because it would drop the access key).

## Files

| File | Does |
|---|---|
| `bridge.mjs` | HTTP server, Rabdi clients (2 s block time, 1 s polling), `/health` |
| `writer.mjs` | The one write queue: explicit nonce/gas/gasPrice, reconcile by hash or nonce, never resend blindly |
| `records.mjs` | One route per record type, the heartbeat, and the keeper |
| `schemas.mjs` | The 9 schemas (copied to `web/src/lib/arkivSchemas.js`) |
| `retry.mjs` | Jittered backoff, for reads only |
| `smoke.mjs` | Live end-to-end test (`npm run smoke`) |
| `writer.test.mjs` | Offline tests of the writer's failure paths (`npm test`) |
| `trust-check.mjs` | Live proof that reads must scope by creator, not only owner |

## Routes

| Route | Writes | Notes |
|---|---|---|
| `POST /readings` | `dynaura.reading` ×N, one batch tx, sealed | `{summaries: [{minute, meter, avg_w, wh, solar_wh, samples, signer, sig}]}` |
| `POST /heartbeat` | `dynaura.heartbeat`, patch + extend 2 min | Waiting heartbeats are merged; renews the live one after a restart |
| `POST /decision` | `dynaura.decision`, sealed, 30 days | |
| `POST /daily` | `dynaura.daily_output`, created then patched | |
| `GET /history?days=7` | (read) | Daily totals, newest first, for Dyna's planner |
| `POST /offer` | `dynaura.offer`, sealed | Expires at `window_end` |
| `POST /cleaning_job` | `dynaura.cleaning_job`, created then patched | Expires a day after `deadline` |
| `POST /maintenance` | `dynaura.maintenance`, sealed | |
| `POST /sale` | `dynaura.sale`, sealed | `{order_id, buyer, kwh, usdc, arc_tx}` |
| `POST /bill` | `dynaura.bill`, sealed | |
| `POST /keeper` | Extends long-lived records near expiry | Also runs every 6 h |
| `GET /health` | (read) | See below |

Status codes: `200` written. `503` queue full: nothing was sent, safe to try later. `502` sent but
the outcome is unknown: **do not resend**, check `/health`. `500` failed, nothing applied. `400`/`413`
bad body.

## `/health`

`ok` is false when there are warnings: a low balance, uncertain writes, a nearly full queue, or a
write stuck for over 90 s. It also shows:
- `writes`: queued, in flight (label, seconds, nonce), done, failed, retried, reconciled,
  coalesced, refused, uncertain list, average write time, last 5 writes
- `heartbeat`: key, alive, seconds left
- `keeper`: last run
- `tGLM` and an explorer link for the wallet

More: [`../arkiv/how-you-use-arkiv.md`](../arkiv/how-you-use-arkiv.md#the-write-path).
