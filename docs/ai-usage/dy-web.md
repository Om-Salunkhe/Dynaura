# AI usage: dy-web (web polish and demo UX)

A Claude Code session (Claude Opus) worked on the web app. A human (Pawan) and a manager session set the scope, and a human reviews every merge into `main`.

| What | How AI was used | Human check |
|---|---|---|
| UX review | Ran the app in demo mode, took headless-Chrome screenshots of every screen (mobile and desktop, light and dark), and wrote a list of confusing, inconsistent and broken spots | The manager read the review before any big change |
| Projector demo mode (`/demo`) | Wrote the page: the 5 demo moments, keyboard control, and calls to the Pi's API when it is reachable | Screenshots at 1920×1080 for every moment and every step of the dust flow |
| Hero flow state (`lib/scene.js`, `lib/hero.js`) | Wrote one shared state for dust → escrow → accept → clean → paid, from the Pi's live stream or a demo timeline shared across browser tabs | Each stage checked on screen |
| 0G offline banner | Wrote the banner for no-AI mode (`runner.mode === "no-ai"` from the Pi) | Screenshot |
| Vercel fix (`lib/connection.js`) | Moved the Pi address and the admin key to runtime and added a "Pi blocked" state for an https page reading an http Pi | Built and grepped the bundle for the key; tested on a local https build |
| Live checks | Ran the Pi API in SIM mode (temp DB, no keys) and checked the screens against it; this found the "output low, checking", no-plan and safe-stop states | Screenshots against the SIM Pi |
| Projector sizes | Made `/demo` fit 1280×720 and 1920×1080 | Screenshots at both sizes |
| Cleaning flow v3 (web) | Wrote the v3 cleaning state (poller for the Pi's /api/cleaning, flagged/approve/dispute/resolve stages, demo timeline), the admin notification with the 0G evidence, Scan panel, the cleaner's Mark done and Dispute, the committee's Resolve, and the honest "no plan" states | Screenshots in demo mode and against a mock Pi that serves the v3 API (approve opened the escrow end to end in the mock) |

All the code was written during the hackathon. Nothing was copied from other projects.
