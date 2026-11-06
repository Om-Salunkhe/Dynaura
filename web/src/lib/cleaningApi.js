// The Pi's cleaning API, v3 (see coord DECISIONS "Cleaning flow v3"):
//   GET  /api/cleaning                 -> { job, history }
//   GET  /api/camera/latest.jpg        -> the last frame the Pi looked at
//   POST /api/admin/cleaning/scan      (admin) capture + 0G check now
//   POST /api/admin/cleaning/approve   (admin) { fee_usdc? } -> opens the Arc escrow
//   POST /api/admin/cleaning/reject    (admin)
//   POST /api/cleaning/done            (cleaner "Mark done", no key) -> Pi starts the confirm window
// One shared poller for every screen; it only runs while a live Pi is connected.
// An older Pi (no `history` array) reports `supported: false` and the app keeps the v2 path.
import { useEffect, useSyncExternalStore } from "react";
import { apiUrl, getJSON, postJSON } from "./api.js";

// data = the whole status (pct, dust_pct, clean_pct, min_gain_pct, fee_usdc, last_check, dust_check, arc, error)
let state = { supported: null, job: null, history: [], data: null, error: null, at: 0 };
const subs = new Set();
let enabled = 0;
let timer = null;

const set = (patch) => {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
};

export async function refreshCleaning() {
  try {
    const d = await getJSON("/api/cleaning");
    if (d && Array.isArray(d.history)) set({ supported: true, job: d.job || null, history: d.history, data: d, error: null, at: Date.now() });
    else set({ supported: false, error: null });
  } catch (e) {
    set({ error: e.message, ...(/HTTP 404/.test(e.message) ? { supported: false } : {}) });
  }
}

function start() {
  if (timer) return;
  refreshCleaning();
  timer = setInterval(refreshCleaning, 2500);
}
function stop() {
  clearInterval(timer);
  timer = null;
}

/** The v3 cleaning state. Pass `on` = a live Pi is connected (no polling otherwise). */
export function useCleaningApi(on) {
  useEffect(() => {
    if (!on) return undefined;
    enabled += 1;
    start();
    return () => {
      enabled -= 1;
      if (!enabled) stop();
    };
  }, [on]);
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => state,
  );
}

const after = (r) => {
  if (r?.job !== undefined) set({ job: r.job });
  refreshCleaning();
  return r;
};

export const cleaningApi = {
  scan: () => postJSON("/api/admin/cleaning/scan", {}, { admin: true }).then(after),
  approve: (fee) => postJSON("/api/admin/cleaning/approve", fee ? { fee_usdc: fee } : {}, { admin: true }).then(after),
  reject: () => postJSON("/api/admin/cleaning/reject", {}, { admin: true }).then(after),
  done: () => postJSON("/api/cleaning/done", {}).then(after),
};

/** Absolute URL for the frame the 0G check looked at (cache-busted per job update). */
export function frameUrl(og, stamp) {
  const u = og?.frame_url || "/api/camera/latest.jpg";
  const abs = /^https?:\/\//.test(u) ? u : `${apiUrl()}${u.startsWith("/") ? "" : "/"}${u}`;
  return stamp ? `${abs}${abs.includes("?") ? "&" : "?"}t=${encodeURIComponent(stamp)}` : abs;
}
