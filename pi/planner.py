"""Dyna's daily plan, decided on 0G.

Input: tomorrow's sun forecast, last 7 days of use, who is away, the society jobs.
Output (validated): when the flats run on solar, when each society job runs,
one to three tips per flat, and how much spare sun to offer nearby shops.
"""
import json
import logging
import os
import re

import config
import zg
from society import BY_ID, ICONS, JOBS

log = logging.getLogger("dynaura.planner")

SYSTEM = """You are Dyna, the energy planner for a small apartment building with a shared rooftop solar panel.
Goal: waste as little solar as possible and keep grid use low.
Rules:
- Water jobs first, then charging, then upkeep. Lifts, corridor lights and CCTV always stay on grid (never schedule them).
- Put heavy jobs in the strongest sun hours. Do not overlap more jobs than the forecast can carry.
- If the sun is weak, move upkeep jobs (garden, pool) to another day by leaving them out.
- A flat that is away uses almost nothing; its share can go to other flats.
- Offer spare solar to nearby shops only if there is clearly more than the building needs.
- Give every flat one to three short tips in recommendations.
- split_kwh (flats + common + buffer) adds up to what the roof can make tomorrow.
Answer with ONE JSON object only, no other text:
{"summary": "one sentence",
 "solar_window": ["HH:MM", "HH:MM"],
 "jobs": [{"id": "<job id>", "start": "HH:MM", "minutes": <int>, "why": "short reason"}],
 "recommendations": {"A": [{"title": "...", "why": "...", "icon": "washer|heater|car|water|leaf|bolt|sun"}], "B": [], "C": []},
 "split_kwh": {"flats": <number>, "common": <number>, "buffer": <number>},
 "shop_offer_kwh": <number>}"""

# Fair share + solar credits (CREDITS_ENABLED): the plan also says where tomorrow's spare sun should go.
SPARE_KEY = """ "spare_plan": {"neighbors_kwh": <number>, "shop_kwh": <number>, "grid_kwh": <number>, "why": "short reason"}}"""


def credits_on() -> bool:
    on = getattr(config, "CREDITS_ENABLED", None)
    return bool(on) if on is not None else os.getenv("CREDITS_ENABLED", "true").lower() == "true"


def system_prompt() -> str:
    if not credits_on():
        return SYSTEM
    return SYSTEM.replace('"shop_offer_kwh": <number>}', '"shop_offer_kwh": <number>,\n' + SPARE_KEY)


def spare_line(forecast: dict, history: list[dict]) -> str:
    """A rough spare-sun forecast: what the roof can make, minus what the flats and the jobs used."""
    used = [float(d["flats_kwh"]) for d in history if isinstance(d.get("flats_kwh"), (int, float))]
    jobs = sum(j["kw"] * j["minutes"] / 60 for j in JOBS)
    if not used:
        return (f"Spare sun forecast: the roof can make about {forecast['building_kwh']} kWh; no history of the "
                f"flats' use yet; the society jobs need up to {jobs:.1f} kWh.")
    avg = sum(used) / len(used)
    spare = max(0.0, forecast["building_kwh"] - avg - jobs)
    return (f"Spare sun forecast: the roof can make about {forecast['building_kwh']} kWh, the flats used about "
            f"{avg:.2f} kWh a day last week and the society jobs need up to {jobs:.1f} kWh, so roughly {spare:.2f} kWh "
            "spare. Say in spare_plan where it should go: neighbours who use more than their share, the shop, or the grid.")


TIME = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")


def _hhmm(s: str, lo: int = 6, hi: int = 18) -> str | None:
    m = TIME.match(str(s).strip())
    if not m:
        return None
    h, mi = int(m.group(1)), int(m.group(2))
    if not lo <= h < hi:
        return None
    return f"{h:02d}:{mi:02d}"


def build_prompt(forecast: dict, history: list[dict], away: dict[str, bool]) -> str:
    hours = ", ".join(f"{h['hour']}:00 {h['radiation']:.0f} W/m2 ({h['cloud']}% cloud)" for h in forecast["hours"])
    jobs = "\n".join(f"- {j['id']}: {j['name']} ({j['group']}), {j['minutes']} min, {j['kw']} kW" for j in JOBS)
    hist = "\n".join(f"- {d['day']}: panel {d.get('panel_kwh', '?')} kWh, flats {d.get('flats_kwh', '?')} kWh, "
                     f"solar share {d.get('solar_pct', '?')}%" for d in history) or "- no history yet"
    return (
        f"Tomorrow ({forecast['date']}): {forecast['strength']} sun, {forecast['sun_hours']} peak-sun-hours, "
        f"roof can make about {forecast['building_kwh']} kWh.\nHourly: {hours}\n\n"
        f"Society jobs:\n{jobs}\n\nLast 7 days (from the building's Arkiv records):\n{hist}\n\n"
        f"Away tomorrow: {', '.join(f for f, a in away.items() if a) or 'nobody'}\n\n"
        + (spare_line(forecast, history) + "\n\n" if credits_on() else "")
        + "Make tomorrow's plan."
    )


def validate(plan: dict, forecast: dict) -> dict:
    jobs = []
    for j in plan.get("jobs") or []:
        jid = str(j.get("id", "")).strip()
        start = _hhmm(j.get("start", ""))
        if jid not in BY_ID or not start:
            continue
        minutes = int(max(10, min(int(j.get("minutes") or BY_ID[jid]["minutes"]), 240)))
        jobs.append({"id": jid, "start": start, "minutes": minutes, "why": str(j.get("why", ""))[:120]})
    if not jobs:
        raise zg.ZGUnavailable("plan had no valid jobs")

    win = plan.get("solar_window") or []
    window = [_hhmm(win[0]) if len(win) > 0 else None, _hhmm(win[1], 6, 19) if len(win) > 1 else None]
    if not all(window) or window[0] >= window[1]:
        window = ["10:00", "15:00"]

    recs = {}
    for flat in ("A", "B", "C"):
        items = (plan.get("recommendations") or {}).get(flat) or []
        recs[flat] = [
            {"title": str(r.get("title", ""))[:60], "why": str(r.get("why", ""))[:80],
             "icon": r.get("icon") if r.get("icon") in ICONS else "sun"}
            for r in items[:3] if r.get("title")
        ]

    split = plan.get("split_kwh") or {}
    total = forecast["building_kwh"]
    split = {k: round(float(split.get(k) or 0), 1) for k in ("flats", "common", "buffer")}
    if sum(split.values()) <= 0:
        split = {"flats": round(total * 0.58, 1), "common": round(total * 0.34, 1), "buffer": round(total * 0.08, 1)}

    extra = {}
    if credits_on():
        sp = plan.get("spare_plan") if isinstance(plan.get("spare_plan"), dict) else {}
        kwh = {}
        for k in ("neighbors_kwh", "shop_kwh", "grid_kwh"):
            try:
                kwh[k] = round(max(0.0, float(sp.get(k) or 0)), 2)
            except (TypeError, ValueError):
                kwh[k] = 0.0
        extra["spare_plan"] = {**kwh, "why": str(sp.get("why") or "")[:120]} if sp else None

    return {
        **extra,
        "date": forecast["date"],
        "summary": str(plan.get("summary", ""))[:200],
        "solar_window": window,
        "jobs": sorted(jobs, key=lambda x: x["start"]),
        "recommendations": recs,
        "split_kwh": split,
        "forecast_kwh": total,
        "strength": forecast["strength"],
        "shop_offer_kwh": round(max(0.0, float(plan.get("shop_offer_kwh") or 0)), 2),
    }


def make_plan(forecast: dict, history: list[dict], away: dict[str, bool]) -> tuple[dict, zg.ZGReply, str]:
    """Returns (validated plan, 0G reply, prompt). Raises zg.ZGUnavailable on any failure."""
    prompt = build_prompt(forecast, history, away)
    reply = zg.chat_maybe_thinking([{"role": "system", "content": system_prompt()}, {"role": "user", "content": prompt}],
                                   config.PLAN_THINKING, max_tokens=6000)
    plan = validate(zg.extract_json(reply.text), forecast)
    log.info("0G plan %s: %s", reply.request_id, plan["summary"])
    return plan, reply, prompt


if __name__ == "__main__":
    from forecast import forecast_day
    f = forecast_day("tomorrow")
    p, r, _ = make_plan(f, [], {"A": False, "B": True, "C": False})
    print(json.dumps({"plan": p, "proof": r.proof()}, indent=2))
