# Open questions: planning docs vs the code

Each item is a decision for Om and Pawan. It compares the planning docs (the 0G, Arc, Arkiv, ENS, dashboard and app-screen plans) with the code on `main` at `9269f34` (Fri 6 Nov, 00:55 IST), and gives a recommended answer. **Where the code already works, the recommendation is usually "the code wins, update the story".**

Priority: **P0** changes the hero demo or a prize requirement. **P1** is visible to judges. **P2** is docs only.

## Decided so far (Pawan, Fri 01:15 IST)

| # | Decision | Owner |
|---|---|---|
| Q1 | 0G confirms `panel_dirty` before an escrow opens | Om |
| Q2 | Link the 0G request ID and Storage root into the cleaning record | `dy-0g` coordinates; `dy-arkiv` adds the Arkiv fields, `dy-arc` the escrow fields (or Om) |
| Q3 | **Build** `EpisodeRegistry` on 0G Galileo | `dy-0g` |
| Q11 | Shorten the hero timing for the demo | the team |
| Q12 | Real-hardware dust calibration | Devang, Om |
| Q22 | Fix the Vercel app: Pi URL set at runtime, a mixed-content banner, a visible connection state, and `VITE_ADMIN_KEY` out of the bundle (the admin types the key at runtime) | `dy-web` |

Still open: everything else in the table below.

| # | Question | Pri | Recommended answer | Decides | Effort |
|---|---|---|---|---|---|
| Q1 | Who flags the dirty panel, 0G or the meter? | P0 | Meter triggers, **0G confirms** before any money moves | Om | ~1 h |
| Q2 | Which proof goes on chain when the cleaner is paid? | P0 | Keep the readings hash on Arc; link the 0G proof through Arkiv | Om, dy-arc, dy-arkiv | ~1 h |
| Q3 | Build `EpisodeRegistry` on 0G Chain or drop it? | P0 | Build a tiny one if there's time; it gives 0G a contract address | Om | 1–1.5 h |
| Q4 | Failed 0G Storage uploads are lost | P0 | Retry queue; patch the Arkiv decision with the root later | Om, dy-arkiv | ~45 min |
| Q5 | "0G offline" moment: what really happens? | P0 | Code is right (grid + pump off). Demo it with a "Plan now" press after cutting the internet | Om, Pawan | script only |
| Q11 | The hero takes ~2 min at today's 1-minute windows | P0 | Make the window an env setting, ~15 s for the demo | Om | 15 min |
| Q12 | Real hardware: `real.py` is a stub, and dust detection needs calibration | P0 | Calibrate `PANEL_BEST_W` under the demo lamp tonight; test that tracing paper drops it below 70% | Devang, Om | tonight |
| Q16 | Arc Studio "as the starting point" | P0 | Rebuild/deploy through Studio, keep the URL and screenshots, say honestly what was done where | Pawan, dy-arc | 1–2 h |
| Q17 | Which Arc bounty? | P0 | "Advanced Stablecoin Logic, In Arc Studio" | Pawan | — |
| Q21 | Some Arkiv records are written but never read | P0 | Cleaner job board reads `cleaning_job` from Arkiv; Trading reads `sale` | dy-arkiv, dy-web | 1–2 h |
| Q22 | The Vercel app can't reach the Pi (https → http) | P0 | Live demo runs the app on the laptop; Vercel shows Arkiv/Arc reads + labelled demo data | dy-web, Pawan | 30 min |
| Q6 | Demo moment names and buttons | P1 | A small "Demo controls" card in the admin view | dy-web, Om | 45 min |
| Q7 | India rule / Germany rule billing | P1 | Drop it for the demo; make the demo bill copy match the one live rule | Pawan | 15 min |
| Q9 | Noon: does Flat B's share go to A or to C? | P1 | Neither: "B is away, so the sun goes to A and C" | — | copy fix |
| Q10 | Escrow flow: who opens, accepts, pays | P1 | The code's flow; the cleaner must accept **before** the paper comes off | — | script only |
| Q13 | Float switch: in the hardware, not in the code | P1 | Devang confirms; if it's an inline cut-off, no code needed | Devang | — |
| Q14 | Home/away switches on the real board? | P1 | If there are no switches, `real.py` needs a software `set_away` | Devang | 10 min |
| Q18 | Contracts in the plan vs the code | P1 | Keep the code's 3 contracts; add `address(0)` checks | dy-arc | 20 min |
| Q23 | Demo-only numbers shown as real (iAI, DISCOM, `.eth` names) | P1 | Remove the iAI chip; label illustrative tiles; drop unregistered `.eth` names | dy-web | 30 min |
| Q27 | Team and credits | P1 | README + LICENSE list all three; collect Telegram and X handles | Pawan | — |
| Q28 | 0G latency, request ID and TEE flag unverified | P1 | Measure tonight; check that the stored ID is the one 0G shows | Om | 20 min |
| Q8 | 3 vs 4 flats | P2 | Settled: 3 flats + the panel = 4 meters | — | docs |
| Q19 | "Committee edit refused" / "rejected fake reading" moments | P2 | Not in the live demo; a Q&A answer | — | — |
| Q20 | Arkiv: 7 planned schemas vs 9 in code, `person_id` | P2 | Code wins; fix one stale comment | dy-arkiv | 5 min |
| Q24 | ENS identity in the app | P2 | No ENS work | — | — |
| Q25 | Flask :5000 (plan) vs FastAPI :8000 (code) | P2 | Code wins | — | docs |
| Q26 | "SolarPay Flex" and other old names | P2 | Code wins: Dynaura | — | docs |

---

## P0: decide first

### Q1. Who flags the dirty panel: 0G or the meter?
- **Plan / brief:** Dyna (on 0G) returns `panel_dirty: true`, then the Arc escrow opens.
- **Code:** `pi/cleaning.py:82` opens the escrow when the median panel reading is under `DUST_PCT` (70%) for a minute. Nothing calls 0G at that point, and `panel_dirty` appears nowhere in the code. The cleaning decision is stored as `mode="meter"` and only its log goes to 0G Storage.
- **Why it matters:** 0G's Physical AI track requires "a 0G call inside the decision loop" and lists "0G used only for logs" as not wanted. The hero step the judges see is currently a threshold.
- **Recommended:** keep the meter as the trigger (it's fast and objective), then make **one 0G checkpoint call before locking money**. Send the last readings, the forecast (cloud cover) and the flats' state; ask for `{"panel_dirty": bool, "confidence": 0-1, "reason": "..."}`. Open the escrow only if `panel_dirty` is true. Store the request ID and TEE flag on the cleaning decision like a plan.
  If 0G is unreachable, **don't open the escrow**. Show "Dust suspected, 0G offline: no money moved" and log it as `no-ai`. That is a safe stop with no faked decision.
- **Owner:** Om (`pi/cleaning.py`, reusing `zg.chat`).

### Q2. Which proof goes on chain when the cleaner is paid?
- **Plan:** the Arc `Cleaned` event carries the 0G `episodeRoot`. **Brief:** "every step is on Arkiv, with the 0G proof".
- **Code:** `CleaningEscrow.release(jobId, outputAfter, proof)` stores `proof` = sha256 of the last 3 signed panel summaries (`pi/cleaning.py:114-118`). The cleaning episode is uploaded to 0G Storage afterwards, and nothing links the Arc tx to it. The Arkiv `cleaning_job` entity has `arc_tx` but no 0G fields.
- **Recommended:** keep the readings hash on chain (it's what the contract can check against Arkiv's signed readings). Link the 0G side through Arkiv: add `og_request_id` (from Q1) and `storage_root` to `dynaura.cleaning_job`. The proof tour is then **Arc tx → Arkiv `cleaning_job` (same `job_id`) → 0G request ID + Storage root**. Changing the contract to carry the root would mean another Studio round for little gain.
- **Owners:** Om (Pi), dy-arkiv (schema + bridge route), dy-arc (no contract change).

### Q3. `EpisodeRegistry` on 0G Chain: build it or drop it?
- **Plan:** `EpisodeRegistry.record(bytes32 root, string chatId, bool ai)` on Galileo (16602), device-only, verified on chainscan; the Pi calls it after each upload.
- **Code:** no such contract. Roots live in SQLite and on Arkiv only.
- **Why it matters:** the 0G Physical AI submission asks for "contract deployment addresses" (not "if any"). An on-chain episode index also makes no-AI episodes visible on 0G (`ai=false`).
- **Recommended:** build it if Om has 1–1.5 h after Q1, Q4 and Q11: about 20 lines of Solidity (evmVersion cancun), one `web3.py` call in the uploader's `on_root`. Otherwise drop it, and list the Arc contracts plus 0G Storage roots.
- **Owner:** Om (Pi call); the contract could be written by dy-arc.

### Q4. Failed 0G Storage uploads are lost
- **Plan:** in the offline moment, "on reconnect, queued roots upload with storagescan links".
- **Code:** `pi/og_storage.py:65-68` logs the failure and moves on. The decision then goes to Arkiv without a root and never gets one.
- **Recommended:** keep failed IDs in a retry list (the episode JSON is already on disk) with backoff. On success, patch the Arkiv `decision` with the root. dy-arkiv adds a `PATCH /decision` route. This is the "reconnect" beat of the offline moment.
- **Owners:** Om, dy-arkiv.

### Q5. The "0G offline" moment: what really happens?
- **Plan:** unplug the internet. Flats go blue, the pump runs on a timer, a "0G offline, no AI" banner shows, and roots upload on reconnect.
- **Code:** `pi/brain.py:81-91` safe-stops: all flats to grid, plan cleared, **pump stays off**, banner via `mode="no-ai"`. But no-AI mode **only starts when a plan is requested** (at start-up, at 20:00, or when the admin presses "Plan today"). Pulling the cable mid-day changes nothing: the Pi keeps following the plan it has.
- **Recommended:** keep the code. "Grid + pump off" is the honest safe stop; in the narration say a real building keeps its old fixed pump timer. In the demo, **cut the internet, then press "Plan today"**: 0G is unreachable, the flats go blue and the banner shows. Do this **after** the hero (Arc and Arkiv go offline too).
  The Pi must keep its LAN link to the laptop: put the Pi on a phone hotspot for internet and the laptop on the same hotspot, then turn off the phone's mobile data.
- **Owners:** Pawan (setup), Om (confirm).

### Q11. The hero takes about 2 minutes
- **Code:** dust and clean are both judged on the median of 12 samples taken every 5 s (`pi/cleaning.py:24`). The median crosses about 35 s after the paper goes on and 35 s after it comes off. Add two Arc transactions, the cleaner's accept, and (after Q1) a 0G call.
- **Recommended:** make the window an env setting (e.g. `CLEAN_WINDOW_S`, default 60) and use about 15 s in the demo (6 samples × 2.5 s). The hero then fits in about 60 s.
- **Owner:** Om.

### Q12. Real hardware: `real.py` is a stub, and dust detection needs calibration
- **Code:** `pi/hw/real.py` raises `NotImplementedError` (Devang's file). On real hardware `panel_health_pct()` returns `None`, so the cleaning watch compares `solar_w` with `PANEL_BEST_W`, which is empty by default. **With it empty there is no dust detection at all.** No calibration procedure exists.
- **Physics check:** the panel meter measures what the flats draw, capped by the light. If the LEDs draw less than the panel can give under the lamp, tracing paper may not lower the reading at all.
- **Recommended:** tonight, under the demo lamp, with all flats on solar: (1) note `solar_w` as `PANEL_BEST_W`; (2) add the tracing paper and check that the reading drops below 70%; (3) remove it and check it returns above 90%. If (2) fails, add load (pump or a resistor) while measuring, or use one sheet more. Write the numbers in `deploy/README.md`.
- **Owners:** Devang, Om.

### Q16. Arc Studio "as the starting point"
- **Arc rules:** every Arc prize requires Arc Studio as the starting point. Include the Studio project URL and show Studio in the demo.
- **Code:** the contracts were written locally, and `contracts/README.md:3` says to paste them into Studio and deploy from there. `contracts/deployments.json` is empty. (The prize text links `studio.arc.com`; our research found the live site at `studio.arc.io`. Use whatever URL the project gets.)
- **Recommended:** create the Studio project now. Prompt Studio from our spec, compare its contracts with ours, deploy from Studio, and keep the project URL and a few screenshots of the Studio chat. In the README, say plainly what was done in Studio and what was done locally. Judges read honesty better than a claim they can disprove.
- **Owners:** Pawan (account), dy-arc.

### Q17. Which Arc bounty?
- **Plan:** not stated. The submission must state one.
- **Recommended:** **"Best Smart Contracts with Advanced Stablecoin Logic, In Arc Studio"**. Its examples include "conditional escrow with … automatic release" (`CleaningEscrow`), "payment splitting" (`SolarBilling`) and multi-step settlement (`ShopTrade`). The DeFi/Onchain Finance bounty is a weaker fit.
- **Owner:** Pawan.

### Q21. Some Arkiv records are written but never read
- **Plan:** 4 readers: the AI prompt history, bill → Arc, the cleaner job board, the resident view.
- **Code reads:** `daily_output` (the planner's 7-day memory, via the bridge), `decision` (History, Home), `maintenance` (History, Admin), `heartbeat` (the "Building online" badge), `offer` (Shop offers).
  **Written but never read:** `reading`, `cleaning_job`, `sale`, `bill`. The cleaner job board reads the Pi's live state (`web/src/pages/CleanerJobs.jsx:14-17`), Trading shows demo sales, and Bill reads the Pi.
- **Why it matters:** Arkiv judges skip "Arkiv used only as a log that nothing reads" and ask whether each feature "changes something your users see". And a cleaner on their phone can't reach the Pi's LAN API anyway.
- **Recommended:** (1) the cleaner job board reads open `dynaura.cleaning_job` entities from Arkiv. The job expires at its deadline, so it disappears from the board when it can't be done any more. Fall back to the Pi. (2) Admin Trading reads `dynaura.sale` instead of demo rows.
- **Owners:** dy-arkiv (read lib), dy-web.

### Q22. The Vercel app can't reach the Pi
- **Plan:** "the laptop dashboard runs locally because the https host can't read the http Pi."
- **Code:** `web/vercel.json` deploys to Vercel, and `VITE_API_URL` is plain http (`localhost:8000` or `dynaura.local:8000`). From an https page the browser blocks those calls, and the app **silently shows demo data** (`web/src/lib/api.js:34-80`). Also, `VITE_ADMIN_KEY` is built into the public bundle.
- **Recommended:** the live demo runs the web app **on the laptop** (`npm run dev` or `vite preview` on http://localhost) pointing at the Pi's LAN IP. The public Vercel link shows the Arkiv and Arc reads (those work over https) plus clearly labelled demo data for the Pi parts. **Don't set `VITE_ADMIN_KEY` on Vercel.** (`deploy/README.md` §4 describes a cloudflared https tunnel to the Pi. It works, but it adds a network dependency on stage, and with the admin key in the bundle it opens the admin routes to the internet.)
- **Owners:** dy-web, Pawan.

## P1: visible to judges

### Q6. Demo moment names and buttons
- **Plan:** 5 moments via `POST /api/moment/<name>`: `morning_plan`, noon, dust, `settle`, `offline_test`. The dashboard has 5 moment buttons, an India/Germany switch and "Settle month".
- **Code:** `/api/moment/{cloud|sun|dust|clean|away-A..C|home-A..C|pump}` (`pi/api.py:315-330`); `dust`, `clean`, `cloud` and `sun` work in SIM only. The plan runs via `/api/plan/run` (a "Plan today" button on Society), bills via `/api/admin/bills` (button on Bill), escrow via `/api/admin/cleaning` (Panel health). **The web app has no buttons for away/home, pump or the SIM moments.**
- **Recommended:** a small "Demo controls" card in the admin view: Plan now (0G), Flat B away/home, Run pump, Post bills, and in SIM only Dust/Clean/Cloud. The scripts use these names.
- **Owners:** dy-web; Om if `real.py` needs `set_away` (Q14).

### Q7. India rule / Germany rule billing
- **Plan:** month-end bills under the "India rule, then the Germany rule", with a switch on the dashboard.
- **Code:** one rule. Each flat pays solar kWh × 0.008 + grid kWh × 0.02 USDC from its own meter (`pi/billing.py`). The demo bill shows "Fixed share · India", a 0.35 sharing credit and a 1/3 common share (`web/src/data/demo.js:77-92`), none of which the Pi computes.
- **Recommended:** drop the switch (it costs explaining time a 4-minute demo doesn't have). Make the demo bill copy match the live rule.
- **Owners:** Pawan (decide), dy-web (copy).

### Q9. Noon: does Flat B's share go to A or to C?
- **0G plan:** to A. **App demo data:** "Flat B's share sent to Flat C" (`web/src/data/demo.js:105`).
- **Code:** there is no per-flat routing. An away flat goes to grid (`pi/jobs.py:57`); the panel feeds every flat on solar, and each flat's bill counts its own metered solar.
- **Recommended:** say "B is away, so the sun goes to A and C", and fix the demo string.

### Q10. Escrow flow: who opens, who accepts, how payout happens
- **Plan:** the Pi opens the escrow automatically, and `open()` needs the cleaner's address up front. In the dashboard the cleaner claims with MetaMask.
- **App screens:** the admin posts ("Lock 2.00 USDC and post"), the cleaner accepts, payout is automatic at 90%+.
- **Code:** both openers exist: automatic when dusty (`CLEAN_AUTO=true`) and the admin's button. The cleaner accepts from their own wallet (`CleaningEscrow.accept`), and the Pi releases automatically. There's no cleaner address up front and no claim.
- **Recommended:** the code's flow is the answer. Two demo consequences:
  - `release` only works on an **accepted** job, so the cleaner must accept **before** the paper comes off. If not, the money stays locked until the deadline refund.
  - The cleaner needs a wallet on Arc testnet with a little USDC for gas, on a phone or a second browser profile. Keep a one-line `accept` script with that wallet as a fallback (dy-arc).

### Q13. Float switch
- **Brief:** "a pump with a float switch". **Code:** `pi/config.py:45` says "model pump has no float switch: fixed run time", and the hardware interface has no float-switch input.
- **Recommended:** Devang confirms. If it's an inline cut-off on the pump wire, no code is needed and the script says "the float switch stops the pump when the tank is full".

### Q14. Home/away switches on the real board
- **Code:** the hardware interface has `away(flat)` ("reads the home/away switch"). In SIM, `/api/moment/away-B` sets it; on real hardware the API refuses it unless `real.py` has `set_away` (`pi/api.py:321`). The brief's hardware list has no switches.
- **Recommended:** if there are no physical switches, Devang adds a software `set_away` to `real.py` so the noon moment works on the board.

### Q18. Contracts in the plan vs the code
- **Plan:** `MeterLedger`, `SolarBilling`, `CleaningEscrow` on a `DynauraBase` (SafeERC20, ReentrancyGuard, device/committee roles), with `address(0)` checks.
- **Code:** `CleaningEscrow`, `ShopTrade`, `SolarBilling`: plain `IERC20` with checked return values, one `oracle` and one `owner`, no `address(0)` checks in constructors or `setOracle`, and no `MeterLedger` (signed readings go to Arkiv instead).
- **Recommended:** keep the code's three contracts and drop `MeterLedger`. Add `address(0)` checks in the Studio pass (Q16). The state-before-transfer order already guards against re-entry.
- **Owner:** dy-arc.

### Q23. Demo-only numbers shown as real
- **Code:** a "42 iAI" chip on Home (`web/src/pages/Home.jsx:38`), DISCOM export and monthly admin tiles, demo sales rows, `flat-a.dynaura.eth` (`web/src/components/Sidebar.jsx:31`), and a fake request ID `0x7f3a…c21e`.
- **Why it matters:** for 0G, iAI means "sign in with your 0G account and spend your credits"; a fake balance invites a hard question. The `.eth` names aren't registered.
- **Recommended:** remove the iAI chip, label the DISCOM/admin month tiles "illustrative", show "Flat A" instead of unregistered `.eth` names, and keep the Demo/Live badge on every page that can fall back.
- **Owner:** dy-web.

### Q27. Team and credits
- **Code:** the README says "Built … by Om Salunkhe and Devang Gandhi", and `LICENSE` matches; Pawan isn't listed. The planning docs' "solo or team?" question is settled in DECISIONS: three people.
- **Recommended:** the README Team section lists all three with roles and **Telegram + X handles** (0G requires them). Om decides whether to add Pawan to `LICENSE`.
- **Owner:** Pawan.

### Q28. 0G latency, request ID and TEE flag
- **Plan:** latency unmeasured; no documented switch to turn thinking off.
- **Code:** `pi/zg.py` uses `0gm-1.0-35b-a3b`, `max_tokens=1200`, a 60 s timeout, and strips `<think>` blocks. The request ID comes from the `ZG-Res-Key` header, else the body's `id`. Our research notes say responses also carry `x_0g_trace.request_id`. The TEE flag is any response field whose name contains tee/verif/attest/signature.
- **Recommended:** tonight, run `python planner.py` on the Pi and record (1) the latency, (2) which ID 0G's own tools show for the call, and that it's the one we store, and (3) whether the TEE field is really filled. On stage, never wait on a cold 0G call: press "Plan now" while talking, or show the morning plan already made, with its ID.
- **Owner:** Om.

## P2: docs only

- **Q8. 3 vs 4 flats.** ENS (`flat-a…d`) and "4 usage rows" assumed 4 flats. The code has 3 flats everywhere (`pi/hw/base.py:9`), and Arkiv's 4 reading rows per minute are panel + A + B + C. **Settled:** 3 flats + the panel = 4 meters.
- **Q19. "Committee edit refused" / "rejected fake reading".** The Arc basics doc lists these moments; they aren't among the 5. The contracts already revert `NotOracle()` for any wallet other than the Pi (covered in `contracts/test/test_contracts.py`). **Recommended:** not in the live demo; keep it as a Q&A answer.
- **Q20. Arkiv schemas.** Plan: 7 schemas (`panel/flat/usage/daily_output/decision/cleaning_job/maintenance_visit`), `person_id = HMAC(COMMITTEE_SECRET, name|flat)`, and `og_root` patched in later. Code: 9 schemas (`reading, heartbeat, daily_output, decision, offer, sale, cleaning_job, maintenance, bill`), **no personal data at all**, and decisions written once after the upload. **Recommended:** the code wins; "we store no personal data" is a stronger privacy answer than an HMAC. Fix the stale comment in `bridge/schemas.mjs` and `web/src/lib/arkivSchemas.js`: `cleaning_job.status` is `open | accepted | paid | refunded`, not `open | done | refunded`.
- **Q24. ENS.** The app uses `.eth` names as identities, and `admin.dynaura.eth` isn't among the plan's 5 names. DECISIONS: ENS is display only and not entered. **Recommended:** no ENS work (see Q23).
- **Q25. API.** Plan: Flask on :5000 with SSE. Code: FastAPI on :8000 with SSE (`pi/api.py`). The code wins.
- **Q26. Names.** The 0G plan still says "SolarPay Flex". The code and every doc say Dynaura. Also settled: the Arc chain ID is **5042002** (`pi/config.py:64`, and viem's `arcTestnet`).
