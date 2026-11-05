# Architecture

```
            sun / lamp
                |
        +---------------+        INA219 0x40 (panel)
        |  5 W panel    |------------------------------+
        +---------------+                              |
                                                       v
 Flat A (0x41, GPIO17)   Flat B (0x44, GPIO27)   Flat C (0x45, GPIO22)   Pump (GPIO23)
        \                       |                       /                 /
         +---------------- Raspberry Pi 4 -------------+-----------------+
                          |   pi/ (Python)  |
                          |  meter loop -> SQLite (7 days)
                          |  signed 1-min summaries
                          |  FastAPI  /api/state  /api/stream
                          +--------+--------+---------+
                                   |        |         |
                    0G Router <----+        |         +----> bridge.mjs -> Arkiv (records, expiry)
                    0G Storage (proofs)     |
                                            +----> Arc (USDC escrow, billing, shop trade)
                                   |
                         web/ (React PWA, Vercel)
                  resident · admin · cleaner · Ask Dyna
```

## Roles

| Who | Owns |
|---|---|
| Om | `pi/` (except `pi/hw/real.py`), `bridge/`, `contracts/`, `web/`, `arkiv/`, `docs/` |
| Devang | Building model, wiring, `pi/hw/real.py`, calibration |

## Hardware interface (agreed first)

| Function | Does |
|---|---|
| `read_meters()` | returns panel, A, B, C readings (V, mA, W) |
| `set_flat(flat, source)` | `"solar"` = relay on, `"grid"` = relay off (safe default) |
| `run_pump(seconds)` | pump on, turns itself off after N seconds |
| `away(flat)` | reads the home/away switch |
| `safe_stop()` | all flats to grid, pump off |

`DYNAURA_HW=sim` uses `pi/hw/sim.py`, `DYNAURA_HW=real` uses `pi/hw/real.py`.
