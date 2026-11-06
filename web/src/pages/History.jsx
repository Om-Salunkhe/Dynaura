import Icon from "../components/Icon.jsx";
import PageHeader from "../components/PageHeader.jsx";
import Proof from "../components/Proof.jsx";
import { panelWeek, timeline } from "../data/demo.js";
import { fetchBills, fetchDailyOutput, fetchDecisions, fetchMaintenance, short, useArkiv } from "../lib/arkiv.js";
import { useRole } from "../lib/role.jsx";

const KIND_TITLE = { plan: "AI plan", ask: "Ask Dyna", dust: "Dust alert", clean: "Panel cleaned" };

function fromArkiv(decisions, maintenance, bills = []) {
  const a = decisions.map((d) => ({
    kind: d.mode === "no-ai" ? "alert" : d.kind === "plan" || d.kind === "ask" ? "ai" : d.kind === "dust" ? "alert" : "clean",
    when: d.day,
    title: d.mode === "no-ai" ? "No-AI mode" : KIND_TITLE[d.kind] || d.kind,
    text: d.summary,
    proof: d.requestId ? `0G request ${short(d.requestId)}` : "no 0G call",
    key: d.key,
    ids: [["og", d.storageRoot], ["arkiv", d.key]],
  }));
  const m = maintenance.map((x) => ({ kind: "clean", when: x.date, title: x.title, text: x.text, key: x.key, ids: [["arc", x.arcTx], ["arkiv", x.key]] }));
  const b = bills.map((x) => ({
    kind: "bill",
    when: `${x.month}-28`, // a month's bill sorts at its end
    title: `Bill · ${x.month}`,
    text: `Flat ${x.flat}: ${x.usdc.toFixed(2)} USDC for ${x.kwh.toFixed(2)} kWh (${x.solarPct}% solar)`,
    key: x.key,
    ids: [["arc", x.arcTx], ["arkiv", x.key]],
  }));
  return [...a, ...m, ...b].sort((x, y) => (x.when < y.when ? 1 : -1));
}

const KIND = {
  ai: { icon: "spark", tone: "bg-sun-soft text-sun-ink" },
  clean: { icon: "broom", tone: "bg-[rgba(47,158,106,0.16)] text-good" },
  alert: { icon: "panel", tone: "bg-[rgba(180,35,24,0.12)] text-bad" },
  bill: { icon: "bill", tone: "bg-inner text-ink-2" },
};

export default function History() {
  const [who] = useRole();
  const dec = useArkiv(() => fetchDecisions(15), null);
  const mnt = useArkiv(() => fetchMaintenance(10), null);
  const bil = useArkiv(() => fetchBills(who.role === "resident" ? { flat: who.flat, limit: 3 } : { limit: 3 }), null, [who.flat]);
  const daily = useArkiv(() => fetchDailyOutput(7), null);
  const live = dec.live && mnt.live;
  const items = live ? fromArkiv(dec.data, mnt.data, bil.live ? bil.data : []) : timeline;
  // Arkiv daily totals, oldest first; bars scale to the best day of the week
  const days = daily.live && daily.data.length ? [...daily.data].reverse() : null;
  const best = days ? Math.max(...days.map((d) => d.panelWh), 1) : 1;
  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        kicker={live ? "Read live from Arkiv · every AI step has a 0G proof" : "Demo data · Arkiv not connected"}
        title="History"
      />

      <section className="card flex flex-col gap-3 rounded-[26px]">
        <div className="flex items-baseline justify-between">
          <span className="text-base font-bold">Panel output, 7 days</span>
          <span className="text-xs text-muted">{days ? "Wh per day · Arkiv" : "% of forecast · demo"}</span>
        </div>
        {days ? (
          <>
            <div className="grid h-24 items-end gap-2" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
              {days.map((d) => (
                <div key={d.key} className="rounded-md bg-sun" style={{ height: `${Math.max(4, (d.panelWh / best) * 100)}%` }} title={`${d.day}: ${d.panelWh.toFixed(1)} Wh · ${d.solarPct}% solar`} />
              ))}
            </div>
            <div className="grid gap-2 text-center text-[11px] text-muted" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
              {days.map((d) => (
                <span key={d.key}>{new Date(`${d.day}T12:00:00`).toLocaleDateString([], { weekday: "short" })}</span>
              ))}
            </div>
            <span className="text-xs text-ink-2">The same daily rows Dyna's planner reads from Arkiv before it plans tomorrow.</span>
          </>
        ) : (
          <>
        <div className="relative grid h-24 grid-cols-7 items-end gap-2">
          <span className="absolute inset-x-0 border-t border-dashed border-bad opacity-60" style={{ bottom: "70%" }} />
          {panelWeek.map((d) => (
            <div
              key={d.day}
              className={`rounded-md ${d.pct < 70 ? "bg-bad opacity-70" : "bg-sun"}`}
              style={{ height: `${d.pct}%` }}
              title={`${d.day}: ${d.pct}%`}
            />
          ))}
        </div>
        <div className="grid grid-cols-7 gap-2 text-center text-[11px] text-muted">
          {panelWeek.map((d) => (
            <span key={d.day}>{d.day}</span>
          ))}
        </div>
        <span className="text-xs text-ink-2">Sun and Mon dipped from dust. Cleaned Monday evening.</span>
          </>
        )}
      </section>

      <section className="card flex flex-col gap-1 rounded-[26px]">
        {items.length === 0 && <span className="text-sm text-muted">No records on Arkiv yet.</span>}
        {items.map((t, i) => {
          const k = KIND[t.kind];
          return (
            <div key={i} className="flex gap-3 py-2">
              <span className={`flex h-10 w-10 flex-none items-center justify-center rounded-xl ${k.tone}`}>
                <Icon name={k.icon} />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-xs text-muted">
                  {t.when} · {t.title}
                </span>
                <span className="text-sm font-bold">{t.text}</span>
                {t.ids ? (
                  <span className="flex flex-wrap gap-1.5 pt-0.5 text-[11px]">
                    {t.proof && <span className="mono py-1 text-muted">{t.proof}</span>}
                    {t.ids.map(([kind, id]) => (
                      <Proof key={kind} kind={kind} id={id} />
                    ))}
                  </span>
                ) : (
                  <span className="mono text-[11px] font-bold text-muted">{t.proof} · demo</span>
                )}
              </span>
            </div>
          );
        })}
      </section>
    </div>
  );
}
