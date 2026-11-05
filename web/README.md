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

The Pi address is set at runtime: tap the Live/Demo pill in any header, or open a link with
`?pi=<address>` (it is remembered). An https page (like Vercel) can't read an http Pi, so the app
says "Pi blocked" and shows demo data. For the live demo, open the app from the laptop on the Pi's
Wi-Fi (`npm run dev`), or give the Pi an https address. The admin key is never in the bundle: the
committee admin types it in the same dialog.

## Projector mode

`/demo` shows the 5 demo moments full screen: morning plan, noon routing, dusty panel,
month-end settle and 0G offline. Keys `1`–`5` pick a moment, `←`/`→` step, `Space` runs the next
action, and `H` hides the buttons. With the Pi reachable the buttons call its API. Without it,
a demo timeline plays, shared by every tab in the browser, so the admin and cleaner tabs follow along.
