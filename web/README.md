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
