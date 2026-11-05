import { useEffect, useRef, useState } from "react";
import { demoState } from "../data/demo.js";

export const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "");

export async function getJSON(path, { timeout = 4000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(API_URL + path, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export const ADMIN_KEY = import.meta.env.VITE_ADMIN_KEY || "";

export async function postJSON(path, body, { admin = false } = {}) {
  const res = await fetch(API_URL + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(admin ? { "X-Admin-Key": ADMIN_KEY } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

/**
 * Live building state from the Pi (Server-Sent Events, once a second).
 * If the Pi can't be reached, falls back to demo data and sets `demo: true`.
 */
export function useLive() {
  const [state, setState] = useState(() => ({ ...demoState(), demo: true, connected: false }));
  const demoTimer = useRef(null);
  const connected = useRef(false);

  useEffect(() => {
    let es;
    let closed = false;

    const startDemo = () => {
      if (demoTimer.current) return;
      demoTimer.current = setInterval(() => setState({ ...demoState(), demo: true, connected: false }), 1000);
    };
    const stopDemo = () => {
      clearInterval(demoTimer.current);
      demoTimer.current = null;
    };

    try {
      es = new EventSource(API_URL + "/api/stream");
      es.onmessage = (e) => {
        if (closed) return;
        connected.current = true;
        stopDemo();
        setState({ ...JSON.parse(e.data), demo: false, connected: true });
      };
      es.onerror = () => {
        connected.current = false;
        startDemo();
      };
    } catch {
      startDemo();
    }
    // If nothing arrives soon, keep the screen moving with demo data
    const firstTry = setTimeout(() => {
      if (!closed && !connected.current) startDemo();
    }, 2500);

    return () => {
      closed = true;
      clearTimeout(firstTry);
      stopDemo();
      es?.close();
    };
  }, []);

  return state;
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
