# pi

Python code that runs on the Raspberry Pi: meters, relays, pump, API, 0G, Arc and Arkiv clients.
The hardware drivers live in `pi/hw/`.

| File | What it does |
|---|---|
| `meter.py` | Reads every meter once a second, signs 1-minute summaries with the device key |
| `planner.py`, `brain.py`, `zg.py` | Tomorrow's plan from 0G Compute; request ID and TEE flag kept per decision |
| `jobs.py` | Runs the plan: flats to solar in the window, tank pump at its slot |
| `dyna.py` | "Ask Dyna" answers on 0G |
| `og_storage.py` | Uploads each decision's episode log to 0G Storage |
| `arkiv.py` | Background queue to the Arkiv bridge |
| `arc.py` | Pi wallet = oracle of the Arc contracts |
| `cleaning.py` | Dusty panel → USDC escrow → paid when output is back above 90% |
| `sales.py` | Settles shop orders after the solar window |
| `billing.py` | Monthly bill per flat from its own meter |

Run it: `DYNAURA_HW=sim .venv/bin/python api.py` (no board needed). Full setup: `deploy/README.md`.
