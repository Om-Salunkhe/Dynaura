# Dynaura: decisions log (Pawan's AI sessions)

The source of truth for the AI build sessions. **If a message disagrees with this file, this file wins.** Newest first. Times are IST.

| When | Decision |
|---|---|
| Fri 01:10 | **Pawan's answers on the P0 open questions:** (1) 0G confirming `panel_dirty` before an escrow opens is Om's job. (2) Linking the 0G request ID + storage root into the cleaning record can be done by Om or by us: `dy-0g` coordinates, `dy-arkiv` adds the Arkiv fields, `dy-arc` adds the escrow fields. (3) **EpisodeRegistry on 0G Galileo is ours** (`dy-0g`). (4) Real-hardware dust calibration is Devang's/Om's. (5) Shortening the hero timing for the demo is the team's. (6) **The Vercel fix + push is ours (`dy-web`)**: a runtime Pi URL, a mixed-content banner, a visible connection state, and the admin key entered at runtime. Pawan authorized pushing this fix to main. |
| Fri 00:55 | **Team:** Pawan, Om, Devang. Om owns the Pi core (`pi/`) and is the original author of `bridge/`, `contracts/` and `web/`. Devang owns the hardware and `pi/hw/real.py` (off-limits to sessions). Pawan's sessions: `dy-arkiv` (`arkiv/` judging files, `bridge/` hardening, the web Arkiv read lib), `dy-arc` (the Arc Studio flow, `contracts/`, Arc deploy and integration), `dy-web` (web polish), `dy-demo` (demo script, README, video, submission texts, AI-usage docs). |
| Fri 00:55 | **Git:** each session works only in its own git worktree, on branch `pawan/<area>`. Only the manager merges into `main`, in small chunks, after a rebase and checks, and with a heads-up to Om. Sessions never touch `pi/hw/`. Changes to `pi/` go through Om (propose them to the manager). |
| Fri 00:55 | **Sponsors (3 slots):** 0G (Physical AI, including the real-hardware prize), Arc (must use Arc Studio as the starting point and show Studio in the demo), Arkiv (Build on Arkiv from scratch). ENS is display only; we are **not** entering the ENS prize. |
| Fri 00:55 | **The hero moment** is the dusty panel → 0G `panel_dirty` → Arc escrow → cleaning → meter > 90% → automatic USDC release, all recorded on Arkiv with the 0G proof. The building has **3 flats (A, B, C)**, matching the hardware. |
| Fri 00:55 | **Package manager:** npm (repo convention, lockfiles present). Pending Pawan's confirmation. |
