// Panel output with Day / Week / Month tabs. Arkiv when it's set up (signed 1-minute readings,
// daily totals); demo figures otherwise, labelled as demo. Bars only: no axes, one baseline.
import { useState } from "react";
import { hourly, panelWeek } from "../data/demo.js";
import { ARKIV_READY, fetchDailyOutput, fetchReadings, useArkiv } from "../lib/arkiv.js";

const TABS = ["Day", "Week", "Month"];
const startOfDay = () => Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
const weekday = (d) => new Date(`${d}T12:00:00`).toLocaleDateString([], { weekday: "short" });

function useSeries(tab) {
  // only ask Arkiv for what the open tab shows (the keyless endpoint is rate limited)
  const day = useArkiv(() => (tab === "Day" ? fetchReadings({ meter: "panel", since: startOfDay(), limit: 720 }) : Promise.resolve([])), null, [tab === "Day"]);
  const days = useArkiv(() => (tab === "Day" ? Promise.resolve([]) : fetchDailyOutput(tab === "Month" ? 30 : 7)), null, [tab]);
  if (tab === "Day") {
    if (day.live && day.data.length) {
      const byHour = {};
      for (const r of day.data) {
        const h = new Date(r.minute * 1000).getHours();
        (byHour[h] ||= []).push(r.avgW);
      }
      const hours = Object.keys(byHour).map(Number).sort((a, b) => a - b);
      return { unit: "kW", source: "Arkiv", bars: hours.map((h) => ({ k: `${h}`, v: byHour[h].reduce((s, x) => s + x, 0) / byHour[h].length })) };
    }
    return {
      unit: "kW",
      source: "demo",
      bars: hourly.map((x, i) => ({ k: `${6 + i}`, v: x ? x[0] * 2.1 : null })),
    };
  }
  if (days.live && days.data.length)
    return { unit: "kWh", source: "Arkiv", bars: [...days.data].reverse().map((d) => ({ k: tab === "Week" ? weekday(d.day) : d.day.slice(8), v: d.panelWh })) };
  if (tab === "Week") return { unit: "%", source: "demo", line: 70, bars: panelWeek.map((d) => ({ k: d.day, v: d.pct, low: d.pct < 70 })) };
  return { unit: "kWh", source: ARKIV_READY ? "Arkiv" : "demo", bars: [] };
}

export default function OutputChart() {
  const [tab, setTab] = useState("Week");
  const s = useSeries(tab);
  const max = Math.max(...s.bars.map((b) => b.v || 0), s.unit === "%" ? 100 : 0.001);
  return (
    <section className="card flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex flex-col">
          <span className="t-caps">Panel output</span>
          <span className="text-[12px]" style={{ color: "var(--t-muted)" }}>
            {s.unit === "%" ? "% of expected per day" : s.unit === "kWh" ? "kWh per day" : "average kW per hour"} · {s.source}
          </span>
        </span>
        <span role="tablist" className="flex rounded-lg p-0.5" style={{ background: "#ecebe7" }}>
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className="min-h-[32px] rounded-md px-3 text-[13px]"
              style={{ background: tab === t ? "var(--t-surface)" : "transparent", color: tab === t ? "var(--t-ink)" : "var(--t-muted)", fontWeight: tab === t ? 600 : 400 }}
            >
              {t}
            </button>
          ))}
        </span>
      </div>
      {s.bars.length === 0 ? (
        <span className="py-8 text-center text-[14px]" style={{ color: "var(--t-muted)" }}>
          Not enough history yet. Daily totals build up on Arkiv as the days pass.
        </span>
      ) : (
        <div>
          <div className="relative flex h-32 items-end justify-around gap-1.5 border-b t-hair">
            {s.line && <span className="absolute inset-x-0 border-t border-dashed" style={{ bottom: `${(s.line / max) * 100}%`, borderColor: "var(--t-alert)" }} />}
            {s.bars.map((b, i) => (
              <span
                key={`${b.k}-${i}`}
                className="max-w-[44px] flex-1 rounded-t-[3px]"
                title={b.v == null ? `${b.k}: –` : `${b.k}: ${b.v.toFixed(s.unit === "%" ? 0 : 2)} ${s.unit}`}
                style={{
                  height: b.v == null ? 3 : `${Math.max(3, (b.v / max) * 100)}%`,
                  background: b.v == null ? "var(--t-line)" : b.low ? "var(--t-alert)" : "var(--t-solar)",
                }}
              />
            ))}
          </div>
          <div className="mt-1.5 flex justify-around gap-1.5">
            {s.bars.map((b, i) => (
              <span key={`${b.k}-l${i}`} className="t-num max-w-[44px] flex-1 text-center text-[11px]" style={{ color: "var(--t-muted)" }}>
                {s.bars.length > 14 && i % 3 ? "" : b.k}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
