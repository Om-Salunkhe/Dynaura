import Icon from "../components/Icon.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { today } from "../data/demo.js";
import { useLive } from "../lib/api.js";
import { FLATS, useRole } from "../lib/role.jsx";

const FLOORS = ["C", "B", "A"]; // top to bottom

export default function Building() {
  const [who] = useRole();
  const live = useLive();
  const ago = live.ts ? Math.max(0, Math.round(Date.now() / 1000 - live.ts)) : null;
  const mine = who.role === "resident" ? who.flat : null;
  const day = today[mine ?? "A"];
  const away = FLOORS.filter((f) => live.flats?.[f]?.away);
  const sharedTo = FLOORS.filter((f) => !live.flats?.[f]?.away && live.flats?.[f]?.source === "solar");

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        kicker={live.demo ? "Demo data · Pi not connected" : `Signed by the meter · ${ago ?? "–"} s ago`}
        title="Building"
      />

      <section className="card flex flex-col gap-2 rounded-[26px]">
        <Row
          icon="panel"
          title="Roof panel"
          value={`${(live.meters?.panel?.w ?? 0).toFixed(2)} W`}
          tone="sun"
          extra={live.pump?.on ? "Tank pump running" : null}
        />
        {FLOORS.map((f) => {
          const st = live.flats?.[f] ?? {};
          const w = live.meters?.[f]?.w ?? 0;
          const tone = st.away ? "idle" : st.source === "solar" ? "sun" : "grid";
          return (
            <Row
              key={f}
              icon="home"
              title={`${FLATS[f].short} · ${FLATS[f].name}${f === mine ? ", you" : ""}`}
              value={st.away ? "Away" : `${w.toFixed(2)} W ${st.source === "solar" ? "solar" : "grid"}`}
              tone={tone}
              highlight={f === mine}
            />
          );
        })}
      </section>

      {mine && (
        <section className="card flex flex-col gap-2.5 rounded-[26px]">
          <div className="flex items-baseline justify-between">
            <span className="text-base font-bold">Your day so far</span>
            <span className="text-lg font-extrabold">{day.kwh.toFixed(2)} kWh</span>
          </div>
          <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
            <span className="bg-sun" style={{ width: `${day.solarPct}%` }} />
            <span className="bg-grid" style={{ width: `${100 - day.solarPct}%` }} />
          </div>
          <div className="flex justify-between text-xs font-semibold">
            <span className="text-sun-ink">{day.solarPct}% solar</span>
            <span className="text-ink-2">{100 - day.solarPct}% grid</span>
          </div>
        </section>
      )}

      {away.length > 0 && sharedTo.length > 0 && (
        <section className="card flex items-start gap-3 rounded-[26px]">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-sun-soft text-sun-ink">
            <Icon name="sun" />
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-bold">
              {away.map((f) => FLATS[f].name).join(", ")} is away. Its spare sun went to{" "}
              {sharedTo.map((f) => FLATS[f].name).join(" and ")}.
            </span>
            <span className="text-xs text-muted">The away flat earns credit on this month's bill</span>
          </span>
        </section>
      )}
    </div>
  );
}

function Row({ icon, title, value, tone, highlight, extra }) {
  const glow = {
    sun: "bg-sun-soft text-sun-ink",
    grid: "bg-[rgba(110,155,255,0.16)] text-grid",
    idle: "bg-inner text-muted",
  }[tone];
  return (
    <div className={`inner flex items-center gap-3 p-3 ${highlight ? "ring-2 ring-ink" : ""}`}>
      <span className={`flex h-10 w-10 flex-none items-center justify-center rounded-xl ${glow}`}>
        <Icon name={icon} />
      </span>
      <span className="flex flex-1 flex-col">
        <span className="text-sm font-bold">{title}</span>
        {extra && <span className="text-xs text-muted">{extra}</span>}
      </span>
      <span className={`text-sm font-extrabold ${tone === "sun" ? "text-sun-ink" : tone === "idle" ? "text-muted" : ""}`}>{value}</span>
    </div>
  );
}
