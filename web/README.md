# web

React + Vite + Tailwind PWA for residents, the admin and the cleaner.

```
cd web
npm install
copy .env.example .env   # Windows (cp on Mac/Linux)
npm run dev
```

Open http://localhost:5173. With the Pi API running, the app shows live data; without it, it shows demo data.

## Environment

Every value is public: no secrets go in `VITE_` variables, because they end up in the bundle.

| Variable | What it is | Default |
|---|---|---|
| `VITE_API_URL` | Default Pi address (can be changed in the app at runtime, or with `?pi=`) | `http://localhost:8000` |
| `VITE_ARKIV_OWNER` | The building wallet that writes the Arkiv records (bridge `/health`) | `0xd961a5C42dd84F003Ef3C85a1bD08BE59A8717Cd` (the live building) |
| `VITE_BUILDING_ID` | Which building's records to read | `sunrise-apartments` |
| `VITE_DEVICE_ADDRESS` | The Pi's device key that signs every meter reading (Verify payout checks it; a live Pi's `/api/health` wins) | `0x1EADd21328207546a4785bE042499B9D228952Ed` |
| `VITE_OG_WALLET` | The Pi's 0G Storage wallet, the fallback link for 0G proofs not indexed yet | none |
| `VITE_ARC_RPC_URL` | Arc testnet RPC | `https://rpc.testnet.arc.io` |
| `VITE_ARC_ESCROW` | CleaningEscrow on Arc testnet | `0xf215116c72784e7490ddf3166dcb53b84855b8b9` |
| `VITE_ARC_SHOP` | ShopTrade on Arc testnet | `0x17b2d9561991f4f7c0d43a5f0be19dc07c73ef47` |
| `VITE_ARC_BILLING` | SolarBilling on Arc testnet | `0x5bd5aecc43968994e90f33df7177fb384401902b` |

The admin key and the Arkiv access key are not here on purpose (see below).

## Deploy on Vercel

Import the repo, set **Root Directory** to `web`, framework Vite. Add every `VITE_…` value from
`web/.env.example` under Environment Variables. `vercel.json` sends every route to `index.html`
so links like `/jobs` work on refresh.

The Pi address is set at runtime, so a new tunnel URL needs no redeploy. The app takes, in order:
`?pi=<address>` in the link (remembered in this browser), then the saved address, then
`VITE_API_URL`, then `http://localhost:8000`. To change or clear it, tap the connection pill (or the
bar on phones), or use the account menu → Connection & admin key.

An https page (Vercel) can't read an http Pi. The app says "Pi URL must be https" instead of failing
quietly. On the Pi, run `cloudflared tunnel --url http://localhost:8000` and open
`https://<app>/?pi=https://<name>.trycloudflare.com`.

The admin key is never in the bundle (there is no `VITE_ADMIN_KEY`). The committee admin types it once
in the Connection dialog; it is sent as `X-Admin-Key`, stays in that browser, and **Lock** forgets it.

## Projector mode

`/demo` shows the 5 demo moments full screen: morning plan, noon routing, dusty panel,
month-end settle and 0G offline. Keys `1`–`5` pick a moment, `←`/`→` step, `Space` runs the next
action, and `H` hides the buttons. With the Pi reachable the buttons call its API. Without it,
a demo timeline plays, shared by every tab in the browser, so the admin and cleaner tabs follow along.
