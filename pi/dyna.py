"""Ask Dyna: residents ask about their power; the answer comes from 0G."""
import json
import time
from collections import defaultdict
from datetime import datetime

import zg

SYSTEM = """You are Dyna, a friendly energy assistant for one flat in a shared-solar apartment building.
Answer in 2 to 4 short sentences, plain words, no markdown. Use only the data given.
If you suggest an action, make it concrete (a time, an appliance). Money is in USDC."""


def _hourly(store, flat: str) -> list[str]:
    since = int(time.time()) - 24 * 3600
    rows = store.summaries(meter=flat, since=since, limit=1440)
    by_hour: dict[str, dict] = defaultdict(lambda: {"wh": 0.0, "solar_wh": 0.0})
    for r in rows:
        h = datetime.fromtimestamp(r["minute"]).strftime("%a %H:00")
        by_hour[h]["wh"] += r["wh"]
        by_hour[h]["solar_wh"] += r["solar_wh"]
    return [f"{h}: {v['wh']:.3f} Wh ({(100 * v['solar_wh'] / v['wh']) if v['wh'] else 0:.0f}% solar)"
            for h, v in sorted(by_hour.items())]


def ask(store, brain, flat: str, question: str) -> dict:
    plan = brain.plan or {}
    context = {
        "flat": flat,
        "last_24h_by_hour": _hourly(store, flat)[-24:],
        "today_plan": {k: plan.get(k) for k in ("summary", "solar_window", "jobs")} if plan else "no plan",
        "tips_for_this_flat": (plan.get("recommendations") or {}).get(flat, []),
        "note": "Meters are a scale model: 1 Wh here is about 1 kWh in a real flat.",
    }
    reply = zg.chat(
        [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": f"Data:\n{json.dumps(context)}\n\nQuestion: {question[:500]}"},
        ],
        max_tokens=500,
        temperature=0.3,
    )
    answer = zg.extract_text(reply.text)
    did = store.add_decision("ask", "ai", question[:120], {"answer": answer, "flat": flat},
                             request_id=reply.request_id, model=reply.model, tee=reply.tee, input=context)
    short = (reply.request_id or "")[:6] + "…" + (reply.request_id or "")[-4:] if reply.request_id else "no id"
    return {
        "answer": answer,
        "request_id": reply.request_id,
        "decision_id": did,
        "proof": f"Answered on 0G · {'TEE verified · ' if reply.tee else ''}{short}",
    }
