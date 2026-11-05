# Finalist demo: 4 minutes live + 3 minutes Q&A

**The story in one line:** a dusty panel costs a building money. Dyna notices it, 0G confirms it, Arc locks the cleaner's fee, the meter proves the panel is clean, the money moves by itself, and every step can be checked.

**Roles** (a suggestion; swap freely):
- **Pawan** talks.
- **Om** drives the laptop and answers the technical Q&A.
- **Devang** works the building: tracing paper, lamp, cables.
- **Ravi the cleaner** is a phone with the cleaner wallet (Om's or Devang's phone).

**Depends on:** OPEN-QUESTIONS Q1 (0G confirms the dust), Q11 (a ~15 s clean/dust window), Q12 (calibration), Q6 (demo buttons) and Q22 (the app runs on the laptop). Lines that change without them are marked **[if Q1 isn't done]**.

---

## Before the room (T-30 min)

| ✓ | Check | How |
|---|---|---|
| ☐ | The Pi runs on the real board | `DYNAURA_HW=real`, `systemctl status dynaura-api dynaura-bridge` |
| ☐ | Demo settings are on | `CLEAN_AUTO=true`, short clean window (Q11), `PANEL_BEST_W` from tonight's calibration, `IGNORE_CLOCK=true` if the plan's solar window doesn't cover the judging slot |
| ☐ | 0G answers fast | `python planner.py` on the Pi: note the latency and request ID |
| ☐ | Arkiv bridge is healthy | `curl 127.0.0.1:5100/health` (wallet, block, tGLM balance) |
| ☐ | Arc wallets are funded | Pi oracle: ≥ 5 USDC (fee + gas). Cleaner wallet: ≥ 0.5 USDC for gas |
| ☐ | No old escrow is open | Panel health shows "ok", not "open"/"accepted" |
| ☐ | Network for the offline moment | The Pi and laptop share a phone hotspot (the Pi keeps LAN when the phone's mobile data goes off) |
| ☐ | Laptop tabs, in order | 1 Home · 2 Society (plan) · 3 Panel health · 4 History · 5 Arkiv explorer · 6 0G Storage explorer · 7 Arc explorer · 8 Arc Studio project |
| ☐ | Cleaner phone | The app's Jobs page, wallet connected on Arc testnet |
| ☐ | Fallbacks ready | A SIM-mode terminal, the backup video of the hero, the `accept` script with the cleaner key |
| ☐ | At T-2 min | Press **Plan now** so a fresh 0G plan with its request ID is on screen |

---

## The run (240 s)

| Time | On screen / on the desk | Who | What they say (say it in your own words) |
|---|---|---|---|
| **0:00–0:20** Hook | The cardboard building under the lamp; the yellow LEDs are on | Pawan | "In Mumbai, thousands of housing societies share one rooftop of solar. Nobody knows who used it. The water pump runs at 7 AM on grid power. And when the panel gets dusty, output quietly drops for weeks. Dynaura is AI-run shared solar. 0G decides, Arc pays, Arkiv remembers." |
| **0:20–0:50** The building and the plan | Point at the board, then the laptop: tab 2, Society | Pawan, Om | "This is a real building in miniature: three flats, a panel, a water pump. A Raspberry Pi meters every flat once a second and signs every minute of readings. Every evening, Dyna asks 0G for tomorrow's plan: when the flats run on sun, when the pump runs, tips per flat. This plan came from 0G **[point at the request ID and TEE badge]**. The relays follow it: yellow LED means solar, blue means grid." |
| **0:50–1:00** The pump (optional, cut if behind) | Press **Run pump** (Demo controls) | Om | "The pump fills the tank inside the sun window Dyna picked." |
| **1:00–1:15** Hero: dust | Devang lays tracing paper on the panel. Tab 3, Panel health: the output line drops | Devang, Pawan | "Now a dust storm. Output falls below 70% of what a clean panel gives under this light." |
| **1:15–1:35** Hero: 0G confirms, Arc locks the fee | The status flips to "open"; the Arc tx appears | Pawan | "The meter suspects dust. Before any money moves, Dyna asks 0G: is it dust, a cloud, or a broken sensor? 0G says dust **[point at the request ID]**. So the building locks 2 USDC in an escrow contract on Arc, for whichever cleaner takes the job." **[if Q1 isn't done]** drop the 0G sentence: "The meter sees dust, and the building locks 2 USDC…" |
| **1:35–1:50** Hero: the cleaner accepts | Hold up the phone: Jobs, **Accept** | Om (as Ravi) | "Ravi, a cleaner, sees the job and accepts it from his own wallet." **Ravi must accept before the paper comes off** (the contract pays only accepted jobs). |
| **1:50–2:20** Hero: clean, paid | Devang peels the paper. The output climbs above 90%; after ~15 s the status flips to "paid". Show the Arc release tx and Ravi's balance | Devang, Pawan | "He cleans the panel. The meter sees the output come back above 90%, holds it for a few seconds, and releases the money. Nobody pressed approve. The sun did." |
| **2:20–2:35** Proof tour (15 s) | Tab 4 History → tab 5 the Arkiv entity → tab 6 the 0G Storage root → tab 7 the Arc tx | Om | "Every step is checkable. This History row is read straight from Arkiv, not from our server. It holds the 0G request ID, the 0G Storage root of the full episode log, and the Arc transaction that paid Ravi." |
| **2:35–3:10** 0G offline: safe stop | Turn off the phone's mobile data. Press **Plan now**. Every LED goes blue; the "0G offline, no AI" banner shows | Pawan, Om | "What if the AI is unreachable? We cut the internet and ask for a plan. 0G can't be reached, so Dynaura never makes up a decision. Every flat goes back to grid, the pump stops, and the event is logged as 'no AI'." Turn the data back on: "When it comes back, the queued logs upload to 0G and Arkiv." |
| **3:10–3:25** Arc Studio | Tab 8: the Studio project with the three contracts | Om | "The contracts were built and deployed in Arc Studio: the cleaning escrow, monthly bills that split the solar by each flat's own meter, and spare noon sun sold to the shop next door." |
| **3:25–4:00** Close | Back to the building | Pawan | "A rooftop panel is shared money, and today it runs on trust and WhatsApp. Dynaura runs it on a meter that signs, an AI that has to show its work, payments that need no approval, and a record book anyone can read. 0G decides, Arc pays, Arkiv remembers. Thank you." |

**If you're behind at 2:35:** skip the Studio beat (it's in the video) and go straight from offline to the close.

---

## When something breaks

| What fails | Signal | Do this (keep talking) |
|---|---|---|
| The board (relays, meters) | LEDs dead, or Panel health shows no number | Start SIM mode on the laptop (`DYNAURA_HW=sim SIM_START=11:00 python api.py`) and use the **Dust / Clean** demo buttons. Say: "Same code, simulated board." |
| Tracing paper doesn't drop output below 70% | The line dips but stays "ok" | Add the second sheet. If it's still "ok", press **Post cleaning job** on Panel health: "The committee can also post a job by hand." |
| 0G is slow (> 10 s) | The plan or dust check spinner | Keep talking and point at the plan made at T-2 min. Never stand silent waiting for a model. |
| 0G is down during the hero | "Dust suspected, 0G offline" | That *is* the safe stop: "No AI, no money moves." Do the offline beat now, then play the backup hero clip. |
| An Arc tx is slow or fails | Status stays "dusty" or "open" | Show the last paid job in History with its Arc tx: "Here's the same flow from our run an hour ago." |
| The cleaner's phone or wallet fails | Accept errors | Run the `accept` fallback script with the cleaner key on the laptop. |
| Venue Wi-Fi is down | Nothing on chain loads | Play the backup hero recording (≤ 60 s), then show the board running locally in no-AI mode. |
| The app shows "Demo" badges | It isn't reaching the Pi | The app must run on the laptop (http), not from Vercel (Q22). Reload `localhost`. |

---

## Q&A prep (3 minutes; short answers, then stop)

| Likely question | Answer (owner) |
|---|---|
| What does 0G decide, and what stays on the Pi? | "0G is the brain, the Pi is the spinal cord. 0G makes the daily plan and confirms dust before money moves. The Pi meters, switches relays and enforces safety on its own." (Om) |
| What if 0G is down? | "Safe stop: everything to grid, pump off, logged as 'no AI'. We never fake a decision. You just saw it." (Om) |
| Can the Pi lie about the meter? | "Every 1-minute summary is signed with the device key and published on Arkiv. The escrow and bills accept only that key, and any other wallet reverts. The bill stores a hash of the signed readings it came from. The remaining trust is the meter hardware itself; next step: a secure element." (Om) |
| Why Arkiv and not Postgres? | "Residents, the committee and the cleaner all read the same records without asking us. Expiry does real work: a shop offer disappears at sunset, a cleaning job when its deadline passes, and the building's heartbeat expires two minutes after the Pi goes quiet, which is our offline alarm with no server." (Pawan) |
| Why Arc and USDC? | "Bills and fees need a stable unit, and USDC is also the gas on Arc. The escrow pays a cleaner the second the panel is clean, with no invoice and no approval." (Pawan) |
| Is the problem real? | Only quote numbers we've verified in the README's sources. (Pawan) |
| What did AI write? | "We used AI coding assistants; `docs/ai-usage/` says where. Every design decision was ours, and we can walk you through any file." (everyone) |
| What was hard? | "Measuring dust: a panel meter shows what the flats draw, not what the panel could give, so we calibrate against a clean panel under the same light." (Devang) |
| Who pays for this? | "The society committee: one cleaner fee and a few cents of fees a month, against weeks of lost output from a dirty panel." (Pawan) |
