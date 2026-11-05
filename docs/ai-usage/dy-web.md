# AI usage: dy-web (web polish and demo UX)

A Claude Code session (Claude Opus) worked on the web app. A human (Pawan) and a manager session set the scope, and a human reviews every merge into `main`.

| What | How AI was used | Human check |
|---|---|---|
| UX review | Ran the app in demo mode, took headless-Chrome screenshots of every screen (mobile and desktop, light and dark), and wrote a list of confusing, inconsistent and broken spots | The manager read the review before any big change |
| Projector demo mode (`/demo`) | Wrote the page: the 5 demo moments, keyboard control, and calls to the Pi's API when it is reachable | Screenshots at 1920×1080 for every moment and every step of the dust flow |
| Hero flow state (`lib/scene.js`, `lib/hero.js`) | Wrote one shared state for dust → escrow → accept → clean → paid, from the Pi's live stream or a demo timeline shared across browser tabs | Each stage checked on screen |
| 0G offline banner | Wrote the banner for no-AI mode (`runner.mode === "no-ai"` from the Pi) | Screenshot |

All the code was written during the hackathon. Nothing was copied from other projects.
