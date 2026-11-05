import Icon from "../components/Icon.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { panelWeek, timeline } from "../data/demo.js";

const KIND = {
  ai: { icon: "spark", tone: "bg-sun-soft text-sun-ink" },
  clean: { icon: "broom", tone: "bg-[rgba(47,158,106,0.16)] text-good" },
  alert: { icon: "panel", tone: "bg-[rgba(180,35,24,0.12)] text-bad" },
  bill: { icon: "bill", tone: "bg-inner text-ink-2" },
};

export default function History() {
  return (
    <div className="flex flex-col gap-3">
      <PageHeader kicker="Stored on Arkiv · every AI step has a 0G proof" title="History" />

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
        {timeline.map((t, i) => {
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
                <a href="#" className="mono text-[11px] font-bold text-link">
                  {t.proof}
                </a>
              </span>
            </div>
          );
        })}
      </section>
    </div>
  );
}
