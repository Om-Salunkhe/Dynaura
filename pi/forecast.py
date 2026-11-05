"""Tomorrow's (or today's) sun from Open-Meteo. No API key needed.

forecast_day("tomorrow") -> {
    "date": "2026-11-06",
    "hours": [{"hour": 6, "radiation": 12.0, "cloud": 40}, ...],   # 6 AM to 6 PM
    "sun_hours": 6.4,            # peak-sun-hours (kWh/m2)
    "building_kwh": 10.2,        # what a BUILDING_KWP roof would make
    "strength": "strong" | "medium" | "weak",
}
"""
import logging
import time
from datetime import date, timedelta

import httpx

import config

log = logging.getLogger("dynaura.forecast")
URL = "https://api.open-meteo.com/v1/forecast"
PERFORMANCE_RATIO = 0.8
_cache: dict[str, tuple[float, dict]] = {}


def _strength(sun_hours: float) -> str:
    if sun_hours >= 4.5:
        return "strong"
    if sun_hours >= 2.5:
        return "medium"
    return "weak"


def forecast_day(which: str = "tomorrow", lat: float | None = None, lon: float | None = None) -> dict:
    day = date.today() + timedelta(days=1 if which == "tomorrow" else 0)
    key = f"{day}:{lat}:{lon}"
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < 1800:
        return hit[1]

    params = {
        "latitude": lat if lat is not None else config.LAT,
        "longitude": lon if lon is not None else config.LON,
        "hourly": "shortwave_radiation,cloud_cover",
        "timezone": config.TIMEZONE,
        "start_date": day.isoformat(),
        "end_date": day.isoformat(),
    }
    r = httpx.get(URL, params=params, timeout=10)
    r.raise_for_status()
    h = r.json()["hourly"]

    hours = []
    for t, rad, cloud in zip(h["time"], h["shortwave_radiation"], h["cloud_cover"]):
        hour = int(t[11:13])
        if 6 <= hour <= 18:
            hours.append({"hour": hour, "radiation": round(rad or 0, 1), "cloud": cloud})

    sun_hours = round(sum(x["radiation"] for x in hours) / 1000, 2)  # kWh/m2 over the day
    out = {
        "date": day.isoformat(),
        "hours": hours,
        "sun_hours": sun_hours,
        "building_kwh": round(sun_hours * config.BUILDING_KWP * PERFORMANCE_RATIO, 1),
        "strength": _strength(sun_hours),
    }
    _cache[key] = (time.time(), out)
    return out


if __name__ == "__main__":
    import json
    print(json.dumps(forecast_day("tomorrow"), indent=2))
