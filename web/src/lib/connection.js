// Where the Pi is, and the admin key. Both are set at runtime, never baked into the bundle:
// - Pi address: the Connection dialog, or any link with ?pi=http://dynaura.local:8000 (remembered)
// - Admin key: typed by the committee admin in the Connection dialog (kept in this browser only)
import { useSyncExternalStore } from "react";

const PI_KEY = "dynaura.pi";
const ADMIN_KEY = "dynaura.adminKey";
const DEFAULT_PI = (import.meta.env.VITE_API_URL || "http://localhost:8000").trim();

const clean = (u) => (u || "").trim().replace(/\/+$/, "");
const read = (k) => {
  try {
    return localStorage.getItem(k) || "";
  } catch {
    return "";
  }
};
const write = (k, v) => {
  try {
    if (v) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  } catch {}
};

function initialPi() {
  try {
    const q = new URLSearchParams(window.location.search).get("pi");
    if (q) {
      write(PI_KEY, clean(q));
      return clean(q);
    }
  } catch {}
  return clean(read(PI_KEY) || DEFAULT_PI);
}

let state = { piUrl: initialPi(), adminKey: read(ADMIN_KEY), open: false, reason: null };
const subs = new Set();
const emit = () => subs.forEach((f) => f());

export const getConnection = () => state;
export const onConnectionChange = (fn) => (subs.add(fn), () => subs.delete(fn));

export function useConnection() {
  return useSyncExternalStore(onConnectionChange, getConnection);
}

export function setPiUrl(url) {
  const piUrl = clean(url) || clean(DEFAULT_PI);
  write(PI_KEY, piUrl === clean(DEFAULT_PI) ? "" : piUrl);
  state = { ...state, piUrl };
  emit();
}

/** Back to the built-in default (VITE_API_URL, else localhost:8000). */
export const clearPiUrl = () => setPiUrl("");
export const defaultPiUrl = () => clean(DEFAULT_PI);

/** "dynaura.local:8000" from "http://dynaura.local:8000" */
export function piHost(url = state.piUrl) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Only absolute http(s) addresses; anything else would quietly hit the web host instead. */
export const isValidPiUrl = (url = state.piUrl) => /^https?:\/\/[^/\s]+/i.test(url || "");

export function setAdminKey(key) {
  const adminKey = (key || "").trim();
  write(ADMIN_KEY, adminKey);
  state = { ...state, adminKey };
  emit();
}

/** Forget the admin key on this browser: admin actions ask for it again. */
export const lockAdmin = () => setAdminKey("");

/** Open the Connection dialog, optionally saying why ("Admin key needed…"). */
export function openConnection(reason = null) {
  state = { ...state, open: true, reason };
  emit();
}

export function closeConnection() {
  state = { ...state, open: false, reason: null };
  emit();
}

const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i;

/**
 * An https page can't read an http Pi: the browser blocks it as mixed content
 * (localhost is the one exception browsers allow).
 */
export const isBlocked = (url = state.piUrl) =>
  typeof window !== "undefined" && window.location.protocol === "https:" && /^http:\/\//i.test(url) && !LOCAL.test(url);
