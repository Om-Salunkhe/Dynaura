// Projector controls shared by every /demo design: which moment is on, each moment's actions
// (the Pi's API when it's reachable, the demo scene otherwise), and the keyboard.
// Keys: 1-5 pick a moment, ← → step through, Space runs the moment's first action, H hides the controls.
import { useCallback, useEffect, useRef, useState } from "react";
import { isOffline } from "../components/OfflineBanner.jsx";
import { postJSON } from "./api.js";
import { MOMENTS, setScene } from "./scene.js";

export function useProjector(live, scene, hero) {
  const [controls, setControls] = useState(true);
  const [note, setNote] = useState(null);
  const connected = !live.demo;
  const offline = isOffline(live);
  const idx = Math.max(0, MOMENTS.findIndex((m) => m.key === scene.moment));
  const moment = MOMENTS[idx];

  const run = useCallback(async (label, fn) => {
    setNote({ text: `${label}…` });
    try {
      await fn();
      setNote({ text: `${label}: done`, ok: true });
    } catch (e) {
      setNote({ text: `${label}: ${e.message}`, bad: true });
    }
  }, []);

  // Each moment's buttons. Live = the Pi does it; demo = the scene plays it.
  const actions = {
    morning: [
      ...(connected ? [{ label: "Ask 0G for today's plan", fn: () => postJSON("/api/plan/run?which=today", {}, { admin: true }) }] : []),
    ],
    noon: connected
      ? [
          { label: "Sun out", fn: () => postJSON("/api/moment/sun", {}, { admin: true }) },
          { label: "Flat B away", fn: () => postJSON("/api/moment/away-B", {}, { admin: true }) },
          { label: "Flat B home", fn: () => postJSON("/api/moment/home-B", {}, { admin: true }) },
          { label: "Run the pump", fn: () => postJSON("/api/moment/pump", {}, { admin: true }) },
        ]
      : [],
    dust: [
      { label: hero.live ? "Dust on (SIM)" : "Tracing paper on", fn: hero.actions.dust, when: ["clean", "paid", "refunded"] },
      ...(hero.live ? [] : [{ label: "Cleaner accepts", fn: hero.actions.accept, when: ["open"] }]),
      // Live: only the SIM's own buttons; the Pi and the cleaner's wallet move the escrow, not us
      ...(hero.live
        ? [{ label: "Paper off (SIM)", fn: hero.actions.reset, when: ["dusty", "accepted", "cleaning"] }]
        : [
            { label: "Paper off", fn: hero.actions.done, when: ["accepted"] },
            { label: "Reset", fn: hero.actions.reset, when: ["dusty", "open", "accepted", "cleaning", "paid", "refunded"], quiet: true },
          ]),
    ],
    settle: [
      connected
        ? { label: "Settle the month on Arc", fn: () => postJSON("/api/admin/bills", {}, { admin: true }) }
        : { label: "Settle the month", fn: () => setScene({ settledAt: Date.now() }) },
    ],
    offline: connected ? [] : [{ label: scene.offline ? "0G back online" : "Unplug 0G", fn: () => setScene({ offline: !scene.offline }) }],
  }[moment.key].filter((a) => !a.when || a.when.includes(hero.stage));

  const first = useRef(null);
  first.current = actions[0];
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.("input, textarea, select")) return;
      const n = Number(e.key);
      if (n >= 1 && n <= MOMENTS.length) setScene({ moment: MOMENTS[n - 1].key });
      else if (e.key === "ArrowRight") setScene({ moment: MOMENTS[Math.min(idx + 1, MOMENTS.length - 1)].key });
      else if (e.key === "ArrowLeft") setScene({ moment: MOMENTS[Math.max(idx - 1, 0)].key });
      else if (e.key.toLowerCase() === "h") setControls((c) => !c);
      else if (e.key === " " && first.current) {
        e.preventDefault();
        run(first.current.label, first.current.fn);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idx, run]);

  return { connected, offline, idx, moment, actions, run, note, controls };
}
