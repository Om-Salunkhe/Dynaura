# How we used AI

ETHGlobal allows AI tools as long as we say where and how, and as long as the team can explain every design decision. This folder is that record.

**In short:** the idea, the hardware, the sponsor choices and every design decision are ours. We used AI coding assistants to write and review code and docs faster, the way you'd use a fast pair programmer. Each part below says who drove it and what the AI did.

## By part of the project

| Part | Who drove it | AI tool | What the AI did | What the humans did |
|---|---|---|---|---|
| Pi software (`pi/`) | Om | TBD (Om) | TBD (Om) | TBD (Om) |
| Hardware (`pi/hw/real.py`, the building, wiring) | Devang | TBD (Devang) | TBD (Devang) | TBD (Devang) |
| Contracts (`contracts/`) | Om, then the `dy-arc` session | TBD (Om), Claude Code, Arc Studio's built-in AI | `dy-arc`: see [`dy-arc.md`](dy-arc.md). Arc Studio generates, tests and deploys contracts from prompts | Contract design (escrow rules, oracle role, settlement) |
| Arkiv bridge and judging files (`bridge/`, `arkiv/`) | Om, then the `dy-arkiv` session | TBD (Om), Claude Code | `dy-arkiv`: see [`dy-arkiv.md`](dy-arkiv.md) | Which records live on Arkiv, who owns them, when they expire |
| Web app (`web/`) | Om, then the `dy-web` session | TBD (Om), Claude Code | `dy-web`: see [`dy-web.md`](dy-web.md) | Screens and flows, from our own app plan |
| 0G episode registry | the `dy-0g` session | Claude Code | See [`dy-0g.md`](dy-0g.md) | The decision to anchor episodes on 0G Chain |
| Docs, demo script, video script, README | the `dy-demo` session | Claude Code | See [`dy-demo.md`](dy-demo.md) | Pawan reviews every claim; the team presents |

## Pawan's AI sessions

Pawan ran several Claude Code sessions in parallel, each in its own git worktree and branch (`pawan/<area>`). A manager session handed out the work and merged the branches into `main` after review. Each session had a written brief, and a shared decisions log settled conflicts. Every decision in that log was made by Pawan or by the team, not by the AI.

| Session | Branch | Log |
|---|---|---|
| manager | merges only | TBD |
| `dy-arkiv` | `pawan/arkiv` | [`dy-arkiv.md`](dy-arkiv.md) |
| `dy-arc` | `pawan/arc` | [`dy-arc.md`](dy-arc.md) |
| `dy-web` | `pawan/web` | [`dy-web.md`](dy-web.md) |
| `dy-0g` | `pawan/zerog` | [`dy-0g.md`](dy-0g.md) |
| `dy-demo` | `pawan/demo` | [`dy-demo.md`](dy-demo.md) |

**Specs and prompts.** ETHGlobal asks spec-driven teams to commit their spec files, prompts and plans. The session briefs, the decisions log and each session's prompt are in [`specs/`](specs/).
