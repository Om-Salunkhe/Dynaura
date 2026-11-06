// Fair share + solar credits (coord prompts/tasks-credits.md).
// Each flat is paid for the spare sun it left unused: earned = R * unused / Σ unused,
// not an equal split. The Pi serves GET /api/credits?period=today|month; without a Pi the
// screens show a demo period built with the same formulas from Pawan's example.
import { useEffect, useState } from "react";
import { getJSON, postJSON, useLive } from "./api.js";

export const FLAT_IDS = ["A", "B", "C"];
const round = (x, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

/**
 * The fair-share model, as specified (all energy in model Wh = real kWh "units"):
 * share = (available - common) / flats; unused = max(0, share - used); over = max(0, used - share);
 * neighbours buy Σ over, the shop its order, the grid the rest; R = their payments;
 * earned[f] = R * unused[f] / Σ unused; equal_split[f] = R / flats.
 */
export function creditsModel({ period = "today", available, common, used, shopOrder, prices, trades = [], chain = null }) {
  const n = FLAT_IDS.length;
  const share = Math.max(0, available - common) / n;
  const unused = Object.fromEntries(FLAT_IDS.map((f) => [f, Math.max(0, share - (used[f] || 0))]));
  const over = Object.fromEntries(FLAT_IDS.map((f) => [f, Math.max(0, (used[f] || 0) - share)]));
  const spare = FLAT_IDS.reduce((s, f) => s + unused[f], 0);
  const neighborWh = Math.min(spare, FLAT_IDS.reduce((s, f) => s + over[f], 0));
  const shopWh = Math.min(spare - neighborWh, shopOrder);
  const gridWh = spare - neighborWh - shopWh;
  const revenue = neighborWh * prices.neighbor + shopWh * prices.shop + gridWh * prices.export;
  const flats = Object.fromEntries(
    FLAT_IDS.map((f) => {
      const earned = spare ? (revenue * unused[f]) / spare : 0;
      const owes = over[f] * prices.neighbor;
      return [
        f,
        {
          share_wh: round(share, 2),
          used_wh: round(used[f] || 0, 2),
          unused_wh: round(unused[f], 2),
          over_wh: round(over[f], 2),
          earned_usdc: round(earned),
          owes_usdc: round(owes),
          net_usdc: round(earned - owes),
          equal_split_usdc: round(revenue / n),
        },
      ];
    }),
  );
  return {
    period,
    available_wh: available,
    common_wh: common,
    spare_wh: round(spare, 2),
    flats,
    pool: { neighbor_wh: round(neighborWh, 2), shop_wh: round(shopWh, 2), grid_wh: round(gridWh, 2), revenue_usdc: round(revenue), prices },
    trades,
    chain,
  };
}

// Pawan's example: A and B each have a fair share of 50 units; A uses 20, B uses 40, so 40 are
// spare (A left 30, B 10) and A earns 75% of what they sell, B 25%. Flat C uses its whole share.
// The pump runs on the sun first (common). The shop buys 25 units, the grid the rest.
const DEMO_PRICES = { neighbor: 0.013, shop: 0.08, export: 0.006 };
export const DEMO_CREDITS = creditsModel({
  period: "today",
  available: 165,
  common: 15,
  used: { A: 20, B: 40, C: 50 },
  shopOrder: 25,
  prices: DEMO_PRICES,
  trades: [
    {
      at: Math.floor(new Date().setHours(12, 15, 0, 0) / 1000),
      window: "12:00–12:15",
      routes: [
        { to: "shop", wh: 25, price: 0.08 },
        { to: "grid", wh: 15, price: 0.006 },
      ],
      request_id: "0xdemo-0g-trade",
      mode: "ai",
      reason: "No flat needs more than its share. The shop's order of 25 units at 0.08 beats the 0.006 feed-in rate; the rest goes to the grid.",
    },
  ],
  chain: { period_id: null, post_tx: null, fund_tx: null, claims: { A: null, B: null, C: null } },
});

/**
 * The credits for a period. status: "live" (the Pi has credits), "off" (a Pi without the
 * feature: show nothing), "demo" (no Pi: Pawan's example, labelled), "loading".
 */
export function useCredits(period = "today") {
  const live = useLive();
  const [st, setSt] = useState({ status: "loading", data: null, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (live.demo) {
      setSt({ status: "demo", data: DEMO_CREDITS, error: null });
      return undefined;
    }
    let alive = true;
    const load = () =>
      getJSON(`/api/credits?period=${period}`)
        .then((d) => alive && setSt({ status: "live", data: d, error: null }))
        .catch((e) => alive && setSt((s) => (/HTTP 404/.test(e.message) ? { status: "off", data: null, error: null } : { ...s, status: s.data ? "live" : "error", error: e.message })));
    load();
    const t = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [live.demo, period, tick]);
  return { ...st, demo: st.status === "demo", reload: () => setTick((n) => n + 1) };
}

/** Committee: post the period to Arc (SolarCredits). Returns the chain block. */
export const settleCredits = (period = "today") => postJSON(`/api/admin/credits/settle?period=${period}`, {}, { admin: true });

export const units = (wh) => {
  const n = Number(wh) || 0;
  const r = Math.round(n * 10) / 10;
  return `${Number.isInteger(r) || r >= 10 ? Math.round(r) : r.toFixed(1)} units`;
};
export const usdc = (x) => `${Number(x || 0).toFixed(2)} USDC`;
export const flatName = (to) => (FLAT_IDS.includes(to) ? `Flat ${to}` : to === "shop" ? "the shop" : to === "grid" ? "the grid" : to);
