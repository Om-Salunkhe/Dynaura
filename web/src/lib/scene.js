// The demo scene: which of the 5 moments is on stage, whether 0G is "offline", and the
// cleaning hero flow when no Pi is connected. One copy per browser, shared by every tab
// (BroadcastChannel + localStorage), so the projector, the admin tab and the cleaner tab
// move together.
//
// The hero flow is stored as a few timestamps, not as a running animation: every tab works
// out "where are we now" from the clock, so two tabs can never disagree or double-fire.
import { useEffect, useState, useSyncExternalStore } from "react";

const KEY = "dynaura.scene";
const CHANNEL = "dynaura.scene";

export const MOMENTS = [
  { key: "morning", n: 1, label: "Morning plan", short: "Plan" },
  { key: "noon", n: 2, label: "Noon routing", short: "Noon" },
  { key: "dust", n: 3, label: "Dusty panel", short: "Dust" },
  { key: "settle", n: 4, label: "Month-end settle", short: "Settle" },
  { key: "offline", n: 5, label: "0G offline", short: "Offline" },
];

const EMPTY = { moment: "morning", offline: false, dustAt: null, acceptAt: null, doneAt: null, settledAt: null };

function load() {
  try {
    return { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY)) };
  } catch {
    return EMPTY;
  }
}

let scene = typeof window === "undefined" ? EMPTY : load();
const subs = new Set();
const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
const emit = () => subs.forEach((f) => f());

channel?.addEventListener("message", (e) => {
  scene = { ...EMPTY, ...e.data };
  emit();
});

export function setScene(patch) {
  scene = { ...scene, ...(typeof patch === "function" ? patch(scene) : patch) };
  try {
    localStorage.setItem(KEY, JSON.stringify(scene));
  } catch {}
  channel?.postMessage(scene);
  emit();
}

export function useScene() {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => scene,
  );
}

/** Re-render every `ms` while `on` (for clock-driven states). */
export function useClock(ms = 200, on = true) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!on) return undefined;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, on]);
  return now;
}

// ---- the hero flow, demo timeline ----------------------------------------
// dust put on -> output falls -> Dyna flags panel_dirty -> escrow opens -> cleaner accepts
// -> cleaner peels the paper -> meter climbs past 90% -> held for a moment -> USDC released
export const DEMO_T = { fall: 2500, flag: 3000, open: 5000, rise: 4000, hold: 3000 };
const CLEAN = 97;
const DUSTY = 52;
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - (1 - t) ** 3);
const lerp = (a, b, t) => a + (b - a) * ease(t);

// Fixed, obviously-fake ids so demo data can't be mistaken for a real tx
const fake = (tag) => `0xdemo${tag}`.padEnd(66, "0");

export function demoHero(s, now = Date.now()) {
  const base = { live: false, dustPct: 70, cleanPct: 90, fee: 2, cleaner: "Ravi" };
  if (!s.dustAt) return { ...base, stage: "clean", pct: CLEAN, flagged: false };
  const sinceDust = now - s.dustAt;
  let pct = lerp(CLEAN, DUSTY, sinceDust / DEMO_T.fall);
  const flagged = sinceDust >= DEMO_T.flag;
  const job = {
    id: 4,
    fee: 2,
    outputBefore: DUSTY,
    deadline: s.dustAt + 60 * 60 * 1000,
    openTx: fake("0pen"),
    requestId: "0xdemo-0g-request",
  };
  if (sinceDust < DEMO_T.open) return { ...base, stage: "dusty", pct, flagged };

  let stage = "open";
  if (s.acceptAt) {
    stage = "accepted";
    job.acceptTx = fake("acc");
    job.cleaner = "Ravi";
  }
  if (s.acceptAt && s.doneAt) {
    const sinceDone = now - s.doneAt;
    pct = lerp(DUSTY, 96, sinceDone / DEMO_T.rise);
    stage = "cleaning";
    if (sinceDone >= DEMO_T.rise + DEMO_T.hold) {
      stage = "paid";
      job.outputAfter = 96;
      job.releaseTx = fake("pay");
      job.proof = fake("og");
    }
  }
  return { ...base, stage, pct, flagged: true, job };
}

export const heroActions = {
  dust: () => setScene({ dustAt: Date.now(), acceptAt: null, doneAt: null, moment: "dust" }),
  accept: () => setScene((s) => (s.dustAt && !s.acceptAt ? { acceptAt: Date.now() } : {})),
  done: () => setScene((s) => (s.acceptAt && !s.doneAt ? { doneAt: Date.now() } : {})),
  reset: () => setScene({ dustAt: null, acceptAt: null, doneAt: null }),
};

export const isFakeId = (id) => typeof id === "string" && id.startsWith("0xdemo");
