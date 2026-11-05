"""The building's shared jobs that can wait for the sun, in priority order.

Lifts, corridor lights and CCTV are never on this list: they always stay on grid.
Only the overhead tank pump is wired in the model (GPIO23); the rest are shown in the app.
"""
JOBS = [
    {"id": "tank", "name": "Overhead tank", "group": "Water", "minutes": 60, "kw": 0.75, "wired": True},
    {"id": "borewell", "name": "Borewell pump", "group": "Water", "minutes": 30, "kw": 1.1},
    {"id": "ro", "name": "RO drinking water", "group": "Water", "minutes": 60, "kw": 0.1},
    {"id": "ev", "name": "EV charge point", "group": "Charging", "minutes": 120, "kw": 3.3},
    {"id": "lift_battery", "name": "Lift backup battery", "group": "Charging", "minutes": 60, "kw": 0.5},
    {"id": "garden", "name": "Garden sprinklers", "group": "Upkeep", "minutes": 30, "kw": 0.4},
    {"id": "pool", "name": "Pool filter", "group": "Upkeep", "minutes": 120, "kw": 0.75},
]
GROUP_ORDER = ["Water", "Charging", "Upkeep"]
BY_ID = {j["id"]: j for j in JOBS}
ICONS = {"washer", "heater", "car", "water", "leaf", "bolt", "sun"}
