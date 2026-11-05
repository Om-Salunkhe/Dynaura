# Submission checklist

Everything the judges require, taken from the prize texts (ETHGlobal Mumbai prize pages, pulled 31 Oct) and ETHGlobal's event rules. **Submissions close Sat 7 Nov 09:00 IST.** Judging runs 09:30–12:30.

Partners (3 slots): **0G**, **Arc**, **Arkiv**. ENS is display only and not entered.

**Status:** `done` · `partial` · `todo` · `check` (claimed, not yet verified on the real setup) · `blocked`.
**Owners:** Om (Pi core), Devang (hardware), Pawan (human: accounts, forms, recording), and the AI sessions `dy-arc`, `dy-arkiv`, `dy-web` and `dy-demo`. The **manager** merges into `main`.

Last updated: Fri 6 Nov, 01:10 IST.

---

## 1. ETHGlobal (every submission)

| # | Requirement | Where / evidence | Owner | Status |
|---|---|---|---|---|
| E1 | Submit on the ETHGlobal form before **Sat 09:00 IST**: name, short description, "how it's made", and the 3 partners (0G, Arc, Arkiv) | Text drafts go in `docs/submission/` | Pawan (form), dy-demo (texts) | todo |
| E2 | Choose the **Finalist + Partner prizes** path. It means a live **4 min demo + 3 min Q&A** in a judging room, 09:30–12:30 | Script: `docs/DEMO-SCRIPT.md` | Pawan | todo |
| E3 | Demo video **2–4 min** (uploads outside that range are rejected), ≥720p. No speed-ups, no AI voice-over, no phone-filmed screen, no music-plus-captions instead of talking. Intro under 20 s, at most 4 bullets per slide | Script: `docs/VIDEO-SCRIPT.md`. **0G caps its video at 3 min, so aim for 2:30–2:55** | Pawan (record), dy-demo (script) | todo |
| E4 | Public GitHub repo with an open-source licence | `Om-Salunkhe/Dynaura` is public; `LICENSE` is MIT | Om | done |
| E5 | **Continuous git history**: no big single commits | 57 small commits so far. The manager must merge branches without squashing | manager | partial |
| E6 | Everything written after **Thu 21:00 IST** (from scratch). Public libraries and starter kits are fine | First commit: Thu 21:42 IST | everyone | check |
| E7 | **AI-usage notes**: where and how AI was used. If we work from specs, the spec files, prompts and plans must be in the repo | `docs/ai-usage/` (one file per session + a team summary) | dy-demo (+ each session keeps its own log) | todo |
| E8 | The team can explain every design decision in Q&A (projects built "entirely by AI" can be ruled out) | Q&A prep sheet in `docs/DEMO-SCRIPT.md` | Om, Devang, Pawan | todo |
| E9 | README a judge can follow: problem, how it works, setup, live links, team | Root `README.md` | dy-demo | todo |

## 2. 0G: "Physical AI: Agents with a Body" (from scratch)

$5,000: 1st $2,500, 2nd $1,500, and **$1,000 for the best build on real hardware**. 0G pays only above its quality bar. One 0G slot makes us eligible for all of its tracks.

**Must show**

| # | Requirement | Where / evidence | Owner | Status |
|---|---|---|---|---|
| G1 | A **0G call inside the decision loop** (decision model) | `pi/planner.py` → `pi/zg.py` (0G Compute Router, `verify_tee`). **The hero dust step does not call 0G yet**, see OPEN-QUESTIONS Q1 | Om | partial |
| G2 | An **episode log on 0G Storage** with a **request ID per decision** | `pi/og_storage.py` uploads one JSON per decision with the Go CLI. Needs the CLI on the Pi and a funded `ZG_PRIVATE_KEY`. Failed uploads are not retried (Q4) | Om | partial |
| G3 | A **replayable simulation** or a **live hardware demo at the 0G booth** | SIM mode exists (`DYNAURA_HW=sim`). `pi/hw/real.py` is still a stub (Q12). Book a booth slot | Devang (hardware), Pawan (booth slot) | partial |
| G4 | A **safe stop** if 0G is unreachable. A fallback that fakes the decision disqualifies | `pi/brain.py` `_no_ai`: all flats to grid, pump off, logged as `no-ai`, uploaded and written to Arkiv. Has to be shown live (Q5) | Om | check |
| G5 | Not wanted: "0G used only for logs", pre-recorded motion, a chatbot with a robot avatar | The demo must show 0G deciding something physical (relays, pump, escrow) | everyone | partial |

**Submission**

| # | Requirement | Where / evidence | Owner | Status |
|---|---|---|---|---|
| G6 | Project name and short description | `docs/submission/` | dy-demo | todo |
| G7 | Public GitHub repo with **README + setup instructions** | Root `README.md`, `deploy/README.md` | dy-demo | todo |
| G8 | Demo video **under 3 min** and a **live demo link** | Video ≤ 2:55. Live link: the Vercel app (Q22) | Pawan, dy-web | todo |
| G9 | **Contract deployment addresses** | Arc contracts (`contracts/deployments.json`, empty now). A 0G Chain contract only if we build `EpisodeRegistry` (Q3) | dy-arc | todo |
| G10 | Team names and contacts (**Telegram and X**) | README "Team" section | Pawan (collect handles) | todo |
| G11 | README table: **0G request ID → 0G Storage root** for real decisions (plan, dust check, no-AI, Ask Dyna), with explorer links | Export from `GET /api/decisions` after a real run | dy-demo (after Om's live run) | todo |
| G12 | Optional extra track "Build with 0G PC": one sentence on **what breaks if 0G is removed** | README 0G section | dy-demo | todo |

## 3. Arc: one bounty, stated in the submission

Every Arc prize requires **Arc Studio as the starting point**. Recommended bounty: **"Best Smart Contracts with Advanced Stablecoin Logic, In Arc Studio"** ($3,000). Its examples include "conditional escrow with automatic release" and "payment splitting", which are our `CleaningEscrow` and `SolarBilling` (Q17).

| # | Requirement | Where / evidence | Owner | Status |
|---|---|---|---|---|
| A1 | **Built in Arc Studio**: include the **Studio project URL** | `contracts/deployments.json` → `studioProject` (empty). The contracts were written locally (Q16) | dy-arc, Pawan (Studio account) | todo |
| A2 | **Show Studio in the demo** (video and live) | Video shot 6 in `docs/VIDEO-SCRIPT.md` | Pawan, dy-demo | todo |
| A3 | **Functional MVP**: a working frontend **and** backend | `web/` (React) + `pi/` (FastAPI) + contracts on Arc testnet | Om, dy-web | partial |
| A4 | **Architecture diagram** | `docs/architecture.md` is ASCII. Needs an image in the README | dy-demo | todo |
| A5 | Video + presentation covering the core functions and the use of **Arc Studio and Circle's developer tools**, with detailed docs | Video + README Arc section | dy-demo, Pawan | todo |
| A6 | Link to the GitHub repo | Submission form | Pawan | todo |
| A7 | Contracts **deployed** on Arc testnet (chain 5042002), addresses + explorer links | `contracts/deployments.json`, `.env`, `web/.env` | dy-arc | todo |
| A8 | **State which bounty** in the submission text | `docs/submission/` | Pawan, dy-demo | todo |
| A9 | Bonus: contracts **reusable by other builders** | Say so in the README: `CleaningEscrow` is a generic "pay when a device proves the job is done" escrow | dy-demo | todo |

## 4. Arkiv: "Build on Arkiv (from scratch)"

$4,000: 1st $3,000, 2nd $1,000. One Arkiv track prize per team. Judged 25% on each of the four files below.

| # | Requirement | Where / evidence | Owner | Status |
|---|---|---|---|---|
| K1 | `/arkiv/friction.md` (25%): what to improve, and what broke (expected, happened, how to reproduce) | | dy-arkiv | todo |
| K2 | `/arkiv/reach.md` (25%): who it's for, would they use it, can they try it today, will we keep building | | dy-arkiv | todo |
| K3 | `/arkiv/why-arkiv.md` (25%): what users lose with Postgres instead, and what we kept off Arkiv and why | | dy-arkiv | todo |
| K4 | `/arkiv/how-you-use-arkiv.md` (25%): do filters, edit rights and expiry fit the app, and does each feature change something users see | | dy-arkiv | todo |
| K5 | `/arkiv/schema.md`: entities, queried fields, owners, expiry | Exists. One stale comment on `cleaning_job.status` (Q20) | dy-arkiv | partial |
| K6 | Writes to the **current testnet** (Rabdi, 7794095) with `@arkiv-network/sdk` | `bridge/` (SDK 1.0.1). Needs a funded building wallet + access key on the Pi | dy-arkiv, Om | check |
| K7 | **At least one feature users see reads from Arkiv** | History, Home timeline, "Building online" badge, Shop offers, Maintenance, and the planner's 7-day memory. `cleaning_job`, `sale`, `bill` and `reading` are written but nothing reads them yet (Q21) | dy-arkiv, dy-web | partial |
| K8 | README: the **wallet address(es)** that wrote our entities and **one query a judge can run** | README Arkiv section, with a copy-paste query | dy-arkiv (wallet + query), dy-demo (README) | todo |
| K9 | Public repo, open-source licence, AI use explained | E4, E7 | | partial |
| K10 | Not counted: SDK installed but never read; Arkiv as a log nothing reads | See K7 | dy-arkiv | partial |

## 5. Demo-day logistics

| # | Item | Owner | Status |
|---|---|---|---|
| L1 | Book a **0G booth slot** for the live hardware demo (the $1k real-hardware prize) | Pawan | todo |
| L2 | Wallets funded: Pi oracle (Arc USDC = gas + escrow fees), a **cleaner wallet** with a little Arc USDC for gas, Arkiv building wallet (tGLM), 0G Storage key (Galileo 0G) | Pawan, dy-arc, dy-arkiv | todo |
| L3 | Spare tracing paper, the desk lamp, a power strip, a phone hotspot for the Pi (for the "0G offline" moment) | Devang | todo |
| L4 | A backup recording of the full hero run (for when the venue network fails) | Pawan | todo |
| L5 | Laptop runs the web app locally against the Pi's LAN address (Q22) | dy-web, Pawan | todo |
