# Architecture

```
            sun / lamp
                |
        +---------------+        INA219 0x45 (panel; replacement board)
        |  5 W panel    |------------------------------+
        +---------------+                              |
                                                       v
 Flat A (0x41, GPIO17)   Flat B (0x44, GPIO27)   Flat C (0x40, GPIO22)   Pump (GPIO23)
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
| Om | Pi software including `pi/hw/real.py`, `bridge/`, `contracts/`, `web/`, `arkiv/`, `docs/` |
| Devang | Physical building, wiring, meter and relay bring-up |

## Hardware interface (agreed first)

| Function | Does |
|---|---|
| `read_meters()` | returns panel, A, B, C readings (V, mA, W) |
| `set_flat(flat, source)` | `"solar"` = relay on, `"grid"` = relay off (safe default) |
| `run_pump(seconds)` | pump on, turns itself off after N seconds |
| `away(flat)` | reads the home/away switch |
| `safe_stop()` | all flats to grid, pump off |

`DYNAURA_HW=sim` uses `pi/hw/sim.py`, `DYNAURA_HW=real` uses `pi/hw/real.py`.

## Final bench wiring and measurement notes

- I2C bus 1: panel `0x45`, Flat A `0x41`, Flat B `0x44`, Flat C `0x40`. The original panel board at `0x40` failed and the replacement moved the panel to `0x45`.
- The flat INA219s are wired low-side, so their bus-voltage register is near zero. The driver uses `SUPPLY_V` for flat voltage while still taking current from each shunt.
- Relays are active-low: A/B/C use GPIO 17/27/22 and the pump uses GPIO 23. Construction and `safe_stop()` put every flat on grid and turn the pump off.
- A missing flat meter is explicitly marked and estimated with `FLAT_NOMINAL_MA`; a missing panel meter is fatal because generation, cleaning and marketplace settlement must not guess.
- `python -m hw.check_real` checks all meters and cycles A/B/C grid → solar → grid. It never runs the pump unless `--pump` is supplied and always safe-stops in `finally`.

## Marketplace data path

```text
signed meter summaries → fair-share window → 0G trade → measured live offer
                                                       ↓ shop wallet prepays on Arc
open ShopTrade order → shop demand → later 0G routes → delivered Wh → Arc settle/refund → Arkiv sale
```

No open Arc order means zero shop demand in the real configuration. The marketplace UI reads `GET /api/marketplace`; Arkiv is the public record, not a source of synthetic fallback offers.
