# web

React + Vite + Tailwind PWA for residents, the admin and the cleaner.

```
cd web
npm install
copy .env.example .env   # Windows (cp on Mac/Linux)
npm run dev
```

Open http://localhost:5173. With the Pi API running, the app shows live data; without it, it shows demo data.

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
