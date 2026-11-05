import Icon from "../components/Icon.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { panelWeek, timeline } from "../data/demo.js";
import { fetchDecisions, fetchMaintenance, short, useArkiv } from "../lib/arkiv.js";

const KIND_TITLE = { plan: "AI plan", ask: "Ask Dyna", dust: "Dust alert", clean: "Panel cleaned" };

function fromArkiv(decisions, maintenance) {
  const a = decisions.map((d) => ({
    kind: d.mode === "no-ai" ? "alert" : d.kind === "plan" || d.kind === "ask" ? "ai" : d.kind === "dust" ? "alert" : "clean",
    when: d.day,
    title: d.mode === "no-ai" ? "No-AI mode" : KIND_TITLE[d.kind] || d.kind,
    text: d.summary,
    proof: d.requestId ? `0G ${short(d.requestId)}${d.storageRoot ? ` · storage ${short(d.storageRoot)}` : ""}` : "no 0G call",
    key: d.key,
  }));
  const m = maintenance.map((x) => ({ kind: "clean", when: x.date, title: x.title, text: x.text, proof: x.arcTx ? `Arc ${short(x.arcTx)}` : "Arkiv record", key: x.key }));
  return [...a, ...m].sort((x, y) => (x.when < y.when ? 1 : -1));
}

const KIND = {
  ai: { icon: "spark", tone: "bg-sun-soft text-sun-ink" },
  clean: { icon: "broom", tone: "bg-[rgba(47,158,106,0.16)] text-good" },
  alert: { icon: "panel", tone: "bg-[rgba(180,35,24,0.12)] text-bad" },
  bill: { icon: "bill", tone: "bg-inner text-ink-2" },
};

export default function History() {
  const dec = useArkiv(() => fetchDecisions(15), null);
  const mnt = useArkiv(() => fetchMaintenance(10), null);
  const live = dec.live && mnt.live;
  const items = live ? fromArkiv(dec.data, mnt.data) : timeline;
  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        kicker={live ? "Read live from Arkiv · every AI step has a 0G proof" : "Demo data · Arkiv not connected"}
        title="History"
      />

      <section className="card flex flex-col gap-3 rounded-[26px]">
        <div className="flex items-baseline justify-between">
          <span className="text-base font-bold">Panel output, 7 days</span>
          <span className="text-xs text-muted">% of forecast</span>
        </div>
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
                <span className="mono text-[11px] font-bold text-link" title={t.key ? `Arkiv entity ${t.key}` : undefined}>
                  {t.proof}
                </span>
              </span>
            </div>
          );
        })}
      </section>
    </div>
  );
}
