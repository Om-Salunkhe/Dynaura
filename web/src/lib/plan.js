// Today's 0G plan from the Pi, and the "who gets the spare sun" story for the screens.
// Live: what the flats are actually doing, plus Dyna's own reason from the plan.
// Demo: one story everywhere.
import { useEffect, useState } from "react";
import { getJSON } from "./api.js";
import { FLATS } from "./role.jsx";

export const DEMO_ROUTING = "Flat A is light and Flat B is heavy, so most of the spare sun is A's: A earns the most when it's sold.";

/** /api/plan, polled while the Pi is reachable (null in demo or before the first answer). */
export function usePlan(connected, every = 10000) {
  const [plan, setPlan] = useState(null);
  useEffect(() => {
    if (!connected) {
      setPlan(null);
      return undefined;
    }
    let alive = true;
    const load = () => getJSON("/api/plan").then((d) => alive && setPlan(d)).catch(() => {});
    load();
    const t = setInterval(load, every);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [connected, every]);
  return plan;
}

const names = (fs) => fs.map((f) => FLATS[f].name).join(" and ");

/**
 * { text, reason, requestId } for the noon routing card.
 * `reason` is Dyna's summary from the 0G plan (live only), `requestId` its 0G request.
 */
export function routingStory(live, plan) {
  if (live.demo) return { text: DEMO_ROUTING, reason: null, requestId: null };
  const flats = live.flats || {};
  const away = Object.keys(FLATS).filter((f) => flats[f]?.away);
  const solar = Object.keys(FLATS).filter((f) => !flats[f]?.away && flats[f]?.source === "solar");
  let text;
  if (!solar.length) text = "No flat is on solar right now.";
  else if (away.length) text = `${names(away)} ${away.length > 1 ? "are" : "is"} away, so the spare sun goes to ${names(solar)}.`;
  else text = `${names(solar)} ${solar.length > 1 ? "are" : "is"} on solar.`;
  const ai = plan?.mode === "ai" && plan.plan;
  return { text, reason: ai ? plan.plan.summary || null : null, requestId: ai ? plan.request_id : null };
}

/**
 * What the plan screens may show. "ai": a real 0G plan. "none": a Pi is connected but there's no
 * AI plan (never fill the gap with demo data labelled 0G). "demo": no Pi at all, demo data, labelled.
 * `api` is usePi("/api/plan"), `live` is useLive().
 */
export function planStatus(api, live) {
  const piLive = !api.demo || (live && !live.demo);
  if (!api.demo && api.data?.plan && api.data.mode !== "no-ai") return { mode: "ai" };
  if (piLive)
    return {
      mode: "none",
      why: api.data?.mode === "no-ai" || api.demo ? "No plan yet: 0G unreachable" : "No 0G plan yet today",
    };
  return { mode: "demo" };
}
