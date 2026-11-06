// Read-only helpers for the twin screens: they reshape what the existing hooks already provide.
import { useEffect, useState } from "react";
import { isOffline } from "../components/OfflineBanner.jsx";
import { admin as demoAdmin } from "../data/demo.js";
import { getJSON } from "../lib/api.js";
import { pct, usdc } from "./format.js";

/** What BuildingTwin draws, straight from the live stream (the demo stream follows the scene). */
export function twinBuilding(live) {
  const offline = isOffline(live);
  return { flats: live.flats || {}, meters: live.meters || {}, pump: !!live.pump?.on, pumpTimer: offline && !!live.pump?.on, offline };
}

/** Panel state for BuildingTwin. */
export const twinPanel = (hero) => ({ pct: hero.pct, expectedW: hero.expectedW, dusty: hero.pct != null && hero.pct < hero.dustPct && hero.stage !== "paid" });

/** One plain sentence for the hero state: the cause and what happens next. */
export function statusLine(hero) {
  const j = hero.job;
  switch (hero.stage) {
    case "dusty":
      return hero.flagged
        ? `Output is under ${hero.dustPct}%. Dyna flagged panel_dirty and the Pi is locking the cleaning fee on Arc.`
        : `Output is under ${hero.dustPct}%. The meter checks for a minute before Dyna flags it.`;
    case "open":
      return `${usdc(j?.fee)} USDC is locked on Arc for a cleaner. It pays out only when the meter sees ${hero.cleanPct}% again.`;
    case "accepted":
      return `A cleaner accepted the job. The meter, not the cleaner, decides when it's clean.`;
    case "cleaning":
      return `The panel is coming back: ${pct(hero.pct)} now. It pays once it holds ${hero.cleanPct}% for a minute.`;
    case "paid":
      return `Back at ${pct(j?.outputAfter ?? hero.pct)}. The escrow paid the cleaner by itself, on the meter's proof.`;
    case "refunded":
      return `Nobody cleaned before the deadline, so the fee went back to the society.`;
    default:
      return `Output is where it should be for this light.`;
  }
}

/** Status tag for the hero state: [text, css colour var]. */
export function statusTag(hero) {
  if (hero.stage === "paid") return ["Paid", "var(--t-paid)"];
  if (hero.stage === "refunded") return ["Refunded", "var(--t-alert)"];
  if (hero.stage === "clean") return ["Clean", "var(--t-ink-2)"];
  if (hero.stage === "dusty") return ["Dust alert", "var(--t-alert)"];
  return ["Escrow open", "var(--t-ink)"];
}

/** One receipt per escrow event, newest last. */
export function heroReceipts(hero) {
  const j = hero.job;
  if (!j) return [];
  const rows = [
    {
      title: `Escrow opened · ${usdc(j.fee)} USDC locked`,
      time: `panel at ${pct(j.outputBefore)}`,
      chips: [
        { kind: "og-root", id: hero.og?.open },
        { kind: "arc", id: j.openTx },
      ],
    },
  ];
  if (j.acceptTx || ["accepted", "cleaning", "paid"].includes(hero.stage))
    rows.push({ title: "Cleaner accepted", time: j.cleaner && !j.cleaner.startsWith?.("0x") ? j.cleaner : null, chips: [{ kind: "arc", id: j.acceptTx }] });
  if (j.releaseTx || j.refundTx)
    rows.push({
      title: j.releaseTx ? `Released · ${usdc(j.fee)} USDC to the cleaner` : `Refunded · ${usdc(j.fee)} USDC to the society`,
      time: j.outputAfter != null ? `back at ${pct(j.outputAfter)}` : null,
      chips: [
        { kind: "og-root", id: hero.og?.paid },
        { kind: "arc", id: j.releaseTx || j.refundTx },
        { kind: "hash", id: j.proof },
      ],
    });
  return rows;
}

/** The three flats' bills for the month: live from the Pi, or the demo figures. */
export function useBills(connected, settledAt) {
  const [bills, setBills] = useState(null);
  useEffect(() => {
    if (!connected) return undefined;
    let alive = true;
    const load = () =>
      Promise.all(["A", "B", "C"].map((f) => getJSON(`/api/bill?flat=${f}`)))
        .then((r) => alive && setBills(r))
        .catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [connected]);
  if (bills)
    return bills.map((b) => ({ flat: b.flat, kwh: b.solar_kwh + b.grid_kwh, solarPct: b.solar_pct, usdc: b.usdc, status: b.paid ? "paid" : b.bill_id > 0 ? "posted" : "due" }));
  return demoAdmin.flats.map((f) => ({ flat: f.id, kwh: f.kwh, solarPct: f.solarPct, usdc: f.usdc, status: settledAt ? "posted" : "due", note: f.note, demo: true }));
}
