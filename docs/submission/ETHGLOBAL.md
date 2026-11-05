# ETHGlobal submission texts (drafts)

Paste these into the form. **Check each field's length limit in the form itself.** Parts in ⟨angle brackets⟩ depend on work still in progress. Delete them if it isn't done by submission time, and never claim what we can't show.

---

## Project name
Dynaura

## Short description (≤ 100 characters)
AI-run shared solar for apartments: 0G decides, Arc pays the panel cleaner, Arkiv keeps the records.

## Description

Apartment buildings in Maharashtra can now share one solar system between their flats (MERC's 2024 virtual net-metering rules). But a shared roof needs someone to run it: whose flat used how much sun, when the water pump should run, and who keeps the panel clean. Today that's a committee member with a spreadsheet.

Dynaura runs it. A Raspberry Pi meters the panel and every flat once a second, signs every minute of readings, and switches each flat between solar and grid with relays. Dyna, our planner on 0G Compute, makes each day's plan from the sun forecast and the building's last week of use, which it reads back from Arkiv.

The hero: put tracing paper on the panel and output drops. ⟨Dyna confirms on 0G that it's dust,⟩ and the building locks a 2 USDC cleaning fee in an escrow on Arc. A cleaner accepts the job from their own wallet and cleans the panel. When the meter sees output back above 90%, the USDC is released automatically. Nobody approves it: the sun does.

Every reading, decision, job, sale and bill goes to Arkiv, so residents, the committee, the cleaner and the judges can check it all without trusting us. If 0G is unreachable, Dynaura never fakes a decision: every flat drops to grid, the pump stops, and the outage is logged.

## How it's made

**Hardware.** A three-flat cardboard building under a desk lamp: a 6 V / 5 W panel, a Raspberry Pi 4, four INA219 current sensors (the panel plus one per flat), and an active-low relay board that switches each flat between solar (yellow LED) and grid (blue LED) and drives a water pump. If the software dies, the relays fall back to grid.

**Pi software (Python, FastAPI).** A 1-second meter loop writes to SQLite and rolls the readings into 1-minute summaries signed with the Pi's device key. A job runner carries out the day's plan; a cleaning watch compares the panel's output with a clean panel under the same light. The web app gets live state over Server-Sent Events. The same code runs in SIM mode with a simulated sun, so it's replayable without the board.

**0G.** The planner calls the 0G Compute Router (OpenAI-compatible, `0gm-1.0`, `verify_tee`) and keeps the request ID and TEE fields per decision. Each decision's full episode log is uploaded to 0G Storage with the Go client, and its root goes on Arkiv. ⟨Every episode root is also recorded in our EpisodeRegistry contract on 0G Galileo.⟩

**Arc.** Three Solidity contracts built and deployed in Arc Studio, all in USDC: a cleaning escrow that releases only when the device oracle reports ≥ 90% output (checked on chain) and refunds after a deadline; monthly bills split by each flat's own meter, carrying a hash of the signed readings; and a shop contract where a neighbour prepays for spare noon sun and the oracle settles by the Wh delivered, refunding the rest in the same transaction. The Pi signs with web3.py; residents, the cleaner and shops sign with their own wallets through viem.

**Arkiv.** A small Node bridge on the Pi writes typed entities with `@arkiv-network/sdk`, all owned by one building wallet: signed readings (7 days), daily totals, decisions with their 0G proofs, shop offers that expire at sunset, cleaning jobs that expire after their deadline, sales, bills, and a 2-minute heartbeat whose expiry is the "building offline" alarm. The planner reads the last 7 days back from Arkiv for every 0G prompt, and the web app reads history, offers and status straight from Arkiv in the browser.

**Web.** React, Vite and Tailwind, with views for residents, the committee, the cleaner and shops.

**Hacky bit.** A panel meter only shows what the flats draw, not what the panel could give. So "dusty" is measured against a calibrated clean-panel reading under the same lamp, with all flats on solar, and judged on a rolling median so a passing shadow can't trigger a payment.

---

## Partner prize texts

### 0G: Physical AI: Agents with a Body (and the real-hardware prize)

Dynaura is a building whose decisions run on 0G. The Pi is the spinal cord: it meters, switches relays and keeps everything safe. 0G is the brain at the checkpoints. Every day the planner sends the forecast, the last week of use and who is away to the 0G Compute Router, and the relays and pump follow the validated plan. ⟨Before any money moves on a dusty panel, 0G confirms `panel_dirty`.⟩ Each decision keeps its 0G request ID and TEE fields, and its full episode log is uploaded to 0G Storage. ⟨Each root is anchored in our EpisodeRegistry contract on 0G Galileo.⟩ If 0G is unreachable, there's no faked decision: all flats go to grid, the pump stops, and a "no AI" episode is logged. It runs on real hardware, which we demo at the 0G booth, and in a replayable SIM mode. Without 0G, the building has no plan and never pays a cleaner.
Request IDs and Storage roots: see the table in our README.

### Arc: Best Smart Contracts with Advanced Stablecoin Logic, In Arc Studio

**Bounty: Best Smart Contracts with Advanced Stablecoin Logic, In Arc Studio.** We built three USDC contracts in Arc Studio (project: ⟨Studio URL⟩) and deployed them to Arc testnet:
1. **CleaningEscrow:** conditional escrow with automatic release. A dusty panel locks the fee, a cleaner accepts, and the building's meter (the only oracle) releases it once output is ≥ 90%, checked on chain. Anyone can refund the society after the deadline. It's reusable for any "pay when a device proves the job is done" case.
2. **SolarBilling:** payment splitting. Each flat's monthly bill comes from its own meter, with a hash of the signed readings, and is paid in USDC straight to the society treasury.
3. **ShopTrade:** multi-step settlement. A nearby shop prepays for spare noon sun; after the window the oracle settles by the Wh delivered and refunds the rest in the same transaction.
USDC is both the money and the gas, so residents and the cleaner need only one token. Addresses: ⟨contracts/deployments.json⟩.

### Arkiv: Build on Arkiv (from scratch)

Arkiv is the building's open record book. One building wallet owns every entity, and readers filter by that owner. Expiry does real work: shop offers disappear when the solar window closes, cleaning jobs after their deadline, raw readings after 7 days, and a 2-minute heartbeat that the Pi renews every 30 s turns into a "building offline" alarm with no monitoring server. Arkiv is read, not just written: Dyna's 0G planner reads the last 7 days of daily totals from Arkiv for every plan, and the app reads the decision history (with 0G proofs), shop offers, the maintenance log and the online status straight from Arkiv in the browser. We store no personal data, only flats A, B and C. The details are in /arkiv: schema, friction, reach, why-arkiv and how-you-use-arkiv. Building wallet and a query you can run: see the README.
