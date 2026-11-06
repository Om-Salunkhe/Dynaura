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
export function creditsModel({ period = "today", available, common, used, weights, shopOrder, prices, trades = [], chain = null }) {
  // FLAT_SHARES weights (A:1,B:1,C:1 by default); a flat with no weight isn't in the period
  const ids = FLAT_IDS.filter((f) => (weights ? weights[f] > 0 : true));
  const totalW = ids.reduce((s, f) => s + (weights ? weights[f] : 1), 0);
  const shareOf = (f) => (Math.max(0, available - common) * (weights ? weights[f] : 1)) / totalW;
  const n = ids.length;
  const unused = Object.fromEntries(ids.map((f) => [f, Math.max(0, shareOf(f) - (used[f] || 0))]));
  const over = Object.fromEntries(ids.map((f) => [f, Math.max(0, (used[f] || 0) - shareOf(f))]));
  const spare = ids.reduce((s, f) => s + unused[f], 0);
  const neighborWh = Math.min(spare, ids.reduce((s, f) => s + over[f], 0));
  const shopWh = Math.min(spare - neighborWh, shopOrder);
  const gridWh = spare - neighborWh - shopWh;
  const revenue = neighborWh * prices.neighbor + shopWh * prices.shop + gridWh * prices.export;
  const flats = Object.fromEntries(
    ids.map((f) => {
      const earned = spare ? (revenue * unused[f]) / spare : 0;
      const owes = over[f] * prices.neighbor;
      return [
        f,
        {
          weight: weights ? weights[f] : 1,
          share_wh: round(shareOf(f), 2),
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
    scale: { real_kwh_per_wh: 1 },
  };
}

// The 3-flat demo period (DECISIONS Sat 00:20, Pawan's numbers): the panel can give 150, so each
// flat's share is 50. A uses 20, B 40, C 50: 40 are spare (A left 30, B 10, C 0), so A earns 75%
// of what they sell, B 25%, C 0, where today's equal split pays each flat a third.
// The shop buys 25 units, the grid the rest.
const DEMO_PRICES = { neighbor: 0.013, shop: 0.08, export: 0.006 };
export const DEMO_CREDITS = creditsModel({
  period: "today",
  available: 150,
  common: 0,
  weights: { A: 1, B: 1, C: 1 },
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
  chain: null,
});

/** The flats in a period (a flat with no share weight isn't in it), in A, B, C order. */
export const periodFlats = (d) => FLAT_IDS.filter((f) => d?.flats?.[f] && (d.flats[f].weight ?? 1) > 0);

/**
 * The Pi reports energy in model Wh; the screens show "units" (real kWh). scale.real_kwh_per_wh
 * converts (1 with BILL_SCALE 1000). Prices are per real kWh, so units x price = USDC.
 */
function toUnits(d) {
  const k = Number(d?.scale?.real_kwh_per_wh) || 1;
  if (k === 1) return d;
  const x = (v) => (v == null ? v : v * k);
  const flats = Object.fromEntries(
    Object.entries(d.flats || {}).map(([f, v]) => [f, { ...v, share_wh: x(v.share_wh), used_wh: x(v.used_wh), unused_wh: x(v.unused_wh), over_wh: x(v.over_wh) }]),
  );
  const pool = d.pool && { ...d.pool, neighbor_wh: x(d.pool.neighbor_wh), shop_wh: x(d.pool.shop_wh), grid_wh: x(d.pool.grid_wh) };
  const trades = (d.trades || []).map((t) => ({ ...t, routes: (t.routes || []).map((r) => ({ ...r, wh: x(r.wh) })) }));
  return { ...d, available_wh: x(d.available_wh), common_wh: x(d.common_wh), spare_wh: x(d.spare_wh), flats, pool, trades };
}

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
        .then((d) => alive && setSt(d?.enabled === false ? { status: "off", data: null, error: null } : { status: "live", data: toUnits(d), error: null }))
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
