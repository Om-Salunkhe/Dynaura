// Building page: where today's sun went. Panel -> Flats A, B, C, the pump, the shop, the grid as
// thin horizontal bars, and the latest 0G trade decision with its reason.
import { FLAT_IDS, units, useCredits } from "../lib/credits.js";
import { TradeRow, soldTrades } from "./FairShare.jsx";

const TONE = { flat: "bg-sun", pump: "bg-[#2F9E6A]", shop: "bg-ink-2", grid: "bg-grid" };

export default function SunFlow() {
  const c = useCredits("today");
  if (c.status === "off" || c.status === "loading" || !c.data) return null;
  const d = c.data;
  const total = Math.max(d.available_wh || 0, 1);
  const rows = [
    ...FLAT_IDS.map((f) => {
      const x = d.flats?.[f] || {};
      const note = x.over_wh > 0 ? `incl. ${units(x.over_wh)} bought from neighbours` : x.unused_wh > 0 ? `${units(x.unused_wh)} of its share left for others` : "its whole share";
      return { key: f, label: `Flat ${f}`, wh: x.used_wh || 0, tone: TONE.flat, note };
    }),
    { key: "pump", label: "Pump (common)", wh: d.common_wh || 0, tone: TONE.pump, note: "runs on the sun in its slot" },
    { key: "shop", label: "Shop", wh: d.pool?.shop_wh || 0, tone: TONE.shop, note: d.pool?.prices?.shop != null ? `at ${d.pool.prices.shop} a unit` : "" },
    { key: "grid", label: "Grid", wh: d.pool?.grid_wh || 0, tone: TONE.grid, note: d.pool?.prices?.export != null ? `feed-in at ${d.pool.prices.export}` : "" },
  ];
  const last = soldTrades(d.trades).slice(-1)[0];

  return (
    <section className="card flex flex-col gap-3 rounded-[14px]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="whitespace-nowrap text-base font-medium">Where the sun went</span>
          {c.demo && <span className="chip bg-inner text-muted">Demo</span>}
        </span>
        <span className="whitespace-nowrap text-[12px] text-muted">panel {units(d.available_wh)}</span>
      </div>
      <div className="flex flex-col gap-2.5">
        {rows.map((r) => (
          <div key={r.key} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
              <span>
                {r.label}
                {r.note && <span className="text-muted"> · {r.note}</span>}
              </span>
              <span className="font-medium">{units(r.wh)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-inner">
              <span className={`block h-full rounded-full ${r.tone}`} style={{ width: `${Math.min(100, (r.wh / total) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
      {last ? (
        <div className="flex flex-col border-t border-line pt-1">
          <span className="pt-2 text-[12px] font-medium text-ink-2">Latest trade decision</span>
          <TradeRow t={last} />
        </div>
      ) : (
        <span className="border-t border-line pt-3 text-[12px] text-muted">No spare sold yet today.</span>
      )}
    </section>
  );
}
