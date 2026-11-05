# Demo video: 2:40 target (hard limits 2:00–2:59)

ETHGlobal accepts **2–4 minutes**, and 0G wants **under 3 minutes**, so the cut must land between **2:00 and 2:59**. Aim for 2:40.

**ETHGlobal's video rules:**
- Real voices talking, no AI voice-over, no music-plus-captions instead of talking.
- No speed-ups. Use straight cuts to skip waiting; never time-lapse.
- Record screens with a screen recorder (QuickTime or OBS), never by filming a monitor. Film the cardboard building with a camera on a tripod.
- At least 720p (record 1080p). Intro under 20 s. At most 4 bullets on any slide.

**Record in pieces.** Record the hero as one take, in real time, with the board and the screen side by side: camera picture-in-picture over the screen recording. Get the other shots separately and cut them together.

---

## Shot list

| # | Time | Picture | Voice (Pawan unless noted) | Must show (for whom) |
|---|---|---|---|---|
| 1 | 0:00–0:15 | The cardboard building under the lamp, slow push-in. Title card: **Dynaura · AI-run shared solar** | "Mumbai's housing societies share rooftop solar, but nobody can see who used it, the pumps run on grid at dawn, and a dusty panel quietly wastes weeks of sun. Dynaura runs the roof." | Hook, under 20 s (ETHGlobal) |
| 2 | 0:15–0:30 | The architecture diagram, building up in 3 steps: 0G → Arc → Arkiv | "A Raspberry Pi meters every flat once a second and signs the readings. **0G decides**: Dyna, our planner, runs on 0G Compute. **Arc pays**: USDC escrow and bills. **Arkiv remembers**: an open record book where entries expire on their own." | The architecture diagram (Arc) |
| 3 | 0:30–0:50 | Screen: Society page, the plan from 0G, with the request ID and TEE badge highlighted. Cut to the board: LEDs switch yellow | "Each evening Dyna asks 0G for tomorrow's plan: when the flats run on sun, when the tank pump runs. Each decision carries its 0G request ID, and the full episode log goes to 0G Storage. The relays follow the plan: yellow is solar, blue is grid." | A 0G call in the decision loop, request IDs, episode log (0G) |
| 4 | 0:50–1:40 | **The hero, one take, picture-in-picture.** Paper on → output drops → "0G: dust" with its request ID → Arc escrow opens (tx) → phone: Ravi accepts → paper off → output > 90% → "paid" → Ravi's balance goes up. Straight cuts only over the waits | "Tracing paper plays the dust. Output falls under 70%. Before any money moves, Dyna asks 0G: dust or cloud? 0G says dust, so the building locks 2 USDC on Arc for a cleaner. Ravi accepts the job from his own wallet and cleans the panel. The meter sees output back above 90% and releases the USDC itself. Nobody pressed approve: the sun did." | Real hardware (0G $1k prize), conditional escrow with automatic release (Arc) |
| 5 | 1:40–1:55 | Screen: History row → Arkiv explorer entity → 0G Storage root → Arc explorer tx | Om: "Every step is checkable. This row is read straight from Arkiv, owned by the building's wallet. It points to the 0G request ID, the Storage root of the episode log, and the Arc transaction that paid Ravi." | Arkiv read by a feature users see (Arkiv), proof links (0G) |
| 6 | 1:55–2:10 | Screen: the Arc Studio project, the three contracts and their deployed addresses; scroll the Studio chat once | Om: "We built and deployed the contracts in Arc Studio: the cleaning escrow, monthly bills split by each flat's own meter, and spare noon sun sold to the shop next door." | **Studio shown in the demo** (Arc, required) |
| 7 | 2:10–2:30 | The board: phone data off → "Plan now" → every LED goes blue; screen: the "0G offline · no AI" banner. Data back on → logs upload | "If 0G can't be reached, Dynaura never fakes a decision. Every flat goes back to grid, the pump stops, and the outage is logged. When the network returns, the queued logs upload." | Safe stop without a faked decision (0G) |
| 8 | 2:30–2:40 | The team at the desk with the building; end card: tagline, repo URL, Arc Studio URL | "Dynaura, by Om, Devang and Pawan, built at ETHGlobal Mumbai. 0G decides, Arc pays, Arkiv remembers." | Team names (0G) |

**Budget check:** 15 + 15 + 20 + 50 + 15 + 15 + 20 + 10 = **160 s**. That leaves 19 s of slack under 2:59.

---

## If something isn't ready by recording time

| Missing | Change |
|---|---|
| 0G dust confirmation (Q1) | Shot 4: "The meter sees dust and the building locks 2 USDC…". Shot 3 carries the 0G story alone. |
| Real board | Record shot 4 in SIM mode with the Dust/Clean buttons and say "simulated board" on screen. Disclose it in the submission text (0G accepts simulation for its main prizes, but not for the $1k hardware one). |
| Arc Studio project | Don't fake shot 6. Show the contracts on the Arc explorer instead, and tell the manager: this blocks the Arc prize. |
| 0G Storage roots | Shot 5 shows the request ID and the Arkiv entity only. Shot 3's "episode log" line goes. |

## Recording tips

- Make the run's 0G plan **before** recording shot 3, so its ID is real and on screen.
- Zoom the browser to 125% so request IDs and hashes are readable at 1080p.
- Keep one uncut real-time copy of shot 4. It doubles as the live demo's fallback.
- Upload a draft early and check the length in the uploader: outside 2:00–4:00 it's rejected at upload.
