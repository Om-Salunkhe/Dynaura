import { useEffect, useState, useSyncExternalStore } from "react";
import { demoState } from "../data/demo.js";
import { getConnection, isBlocked, isValidPiUrl, onConnectionChange, openConnection } from "./connection.js";
import { demoHero, getScene } from "./scene.js";

/** The Pi's address right now (set at runtime, see lib/connection.js). */
export const apiUrl = () => getConnection().piUrl;

const blockedError = () => new Error("Blocked: this https page can't reach an http Pi");
const unusable = () => (isBlocked() ? blockedError() : !isValidPiUrl() ? new Error("The Pi address isn't a valid http(s) URL") : null);

export async function getJSON(path, { timeout = 4000 } = {}) {
  if (unusable()) throw unusable();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(apiUrl() + path, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** Admin calls need the key the committee admin typed in (it is never in the bundle). */
export async function postJSON(path, body, { admin = false } = {}) {
  if (unusable()) throw unusable();
  const key = getConnection().adminKey;
  if (admin && !key) {
    openConnection("This action needs the committee admin key.");
    throw new Error("Admin key needed");
  }
  const res = await fetch(apiUrl() + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(admin ? { "X-Admin-Key": key } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  if (res.status === 403 && admin) {
    openConnection("The Pi refused the admin key. Check it and try again.");
    throw new Error("Admin key refused");
  }
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

// ---- live state: one stream for the whole app ----------------------------
// Every screen (and the 0G-offline banner) shares one EventSource. If the Pi can't be
// reached the app shows demo data and retries with backoff (2 s -> 10 s) instead of the
// browser's endless 3-second reconnect.
const demoLive = () => {
  const s = { ...demoState(), demo: true, connected: false, blocked: isBlocked(), reason: whyNot(), runner: { mode: "plan", jobs: {} } };
  const sc = getScene();
  if (sc.offline) {
    // 0G "unplugged" on the projector: the same safe defaults the Pi uses
    for (const f of Object.keys(s.flats)) s.flats[f] = { ...s.flats[f], source: "grid" };
    s.runner = { mode: "no-ai", jobs: {} };
    s.meters.panel = { ...s.meters.panel, w: 0 };
    s.solar_w = 0;
  } else if (sc.dustAt) {
    const pct = demoHero(sc).pct;
    s.meters.panel = { ...s.meters.panel, w: +(2.1 * (pct / 100)).toFixed(3) };
    s.solar_w = s.meters.panel.w;
  }
  return s;
};

// Why there's no live data, for the connection pill
let failReason = "connecting…";
function whyNot() {
  if (isBlocked()) return "https page, http Pi";
  if (!isValidPiUrl()) return "address isn't a valid URL";
  return failReason;
}

let liveState = demoLive();
const liveSubs = new Set();
let es = null;
let demoTimer = null;
let retryTimer = null;
let closeTimer = null;
let retryMs = 2000;

const setLive = (s) => {
  liveState = s;
  liveSubs.forEach((f) => f());
};
const startDemo = () => {
  if (demoTimer) return;
  setLive(demoLive());
  demoTimer = setInterval(() => setLive(demoLive()), 1000);
};
const stopDemo = () => {
  clearInterval(demoTimer);
  demoTimer = null;
};

function openStream() {
  clearTimeout(retryTimer);
  retryTimer = null;
  if (isBlocked() || !isValidPiUrl()) {
    startDemo(); // the browser would refuse anyway; say so instead of spamming the console
    return;
  }
  try {
    es = new EventSource(apiUrl() + "/api/stream");
  } catch {
    startDemo();
    return;
  }
  const first = setTimeout(() => liveState.demo && startDemo(), 2500);
  es.onmessage = (e) => {
    retryMs = 2000;
    stopDemo();
    setLive({ ...JSON.parse(e.data), demo: false, connected: true });
  };
  es.onerror = () => {
    clearTimeout(first);
    failReason = "no answer";
    es?.close();
    es = null;
    startDemo();
    if (liveSubs.size) retryTimer = setTimeout(openStream, retryMs);
    retryMs = Math.min(retryMs * 2, 10000);
  };
}

function subscribe(fn) {
  liveSubs.add(fn);
  clearTimeout(closeTimer);
  if (!es && !retryTimer) openStream();
  if (liveState.demo) startDemo();
  return () => {
    liveSubs.delete(fn);
    if (liveSubs.size) return;
    // page changes unmount and remount in one go: don't drop the stream for that
    closeTimer = setTimeout(() => {
      if (liveSubs.size) return;
      es?.close();
      es = null;
      clearTimeout(retryTimer);
      retryTimer = null;
      stopDemo();
    }, 1500);
  };
}

// A new Pi address: drop the old stream and connect to the new one straight away
let lastUrl = getConnection().piUrl;
onConnectionChange(() => {
  const { piUrl } = getConnection();
  if (piUrl === lastUrl) return;
  lastUrl = piUrl;
  failReason = "connecting…";
  es?.close();
  es = null;
  retryMs = 2000;
  stopDemo();
  setLive(demoLive());
  if (liveSubs.size) {
    startDemo();
    openStream();
  }
});

/**
 * Live building state from the Pi (Server-Sent Events, once a second).
 * If the Pi can't be reached, falls back to demo data and sets `demo: true`.
 */
export function useLive() {
  return useSyncExternalStore(subscribe, () => liveState);
}

/** Fetch once from the Pi; use `fallback` when it is offline. */
export function usePi(path, fallback) {
  const [data, setData] = useState({ data: fallback, demo: true, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    getJSON(path)
      .then((d) => alive && setData({ data: d, demo: false, loading: false }))
      .catch(() => alive && setData({ data: fallback, demo: true, loading: false }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick]);
  return { ...data, reload: () => setTick((t) => t + 1), set: (d) => setData({ data: d, demo: false, loading: false }) };
}

/** "0x7f3a…c21e" */
export const shortId = (id) => (id && id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id || "");
