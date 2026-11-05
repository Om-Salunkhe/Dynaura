import { Link } from "react-router-dom";
import DemoBadge from "../components/DemoBadge.jsx";
import Icon from "../components/Icon.jsx";
import Legend from "../components/Legend.jsx";
import PageHeader from "../components/PageHeader.jsx";
import StackBars from "../components/StackBars.jsx";
import { hourly, plan, recommendations, today } from "../data/demo.js";
import { shortId, useLive, usePi } from "../lib/api.js";
import { FLATS, useRole } from "../lib/role.jsx";

export default function Home() {
  const [who] = useRole();
  const flat = FLATS[who.flat];
  const live = useLive();
  const meter = live.meters?.[flat.id];
  const source = live.flats?.[flat.id]?.source ?? "grid";
  const day = today[flat.id];
  const api = usePi("/api/plan", null);
  const livePlan = !api.demo && api.data?.plan;
  const recs = livePlan ? api.data.plan.recommendations?.[flat.id] ?? [] : recommendations;
  const reqId = livePlan ? shortId(api.data.request_id) : plan.requestId;

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        kicker={`${flat.name} · ${flat.floor}`}
        title="Your energy"
        right={
          <span className="chip border border-line bg-card-solid font-semibold">
            <Icon name="bolt" size={14} className="text-sun-ink" />
            42 iAI
          </span>
        }
      />

      <Link
        to="/ask"
        className="flex min-h-[44px] items-center gap-2.5 rounded-full border border-line bg-card py-1.5 pl-4 pr-1.5 text-sm text-muted"
      >
        <Icon name="spark" size={18} className="text-sun-ink" />
        <span className="flex-1">Ask Dyna about your power…</span>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-btn text-btn-ink">
          <Icon name="arrowRight" size={16} stroke={2.4} />
        </span>
      </Link>

      <section className="card flex flex-col gap-4 rounded-[26px] p-[18px]">
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-2 text-[13px] text-muted">
              Using right now <DemoBadge demo={live.demo} />
            </span>
            <span className="flex items-baseline gap-1.5">
              <span className="text-[46px] font-extrabold leading-none tracking-[-1.5px]">{(meter?.w ?? 0).toFixed(2)}</span>
              <span className="text-base text-muted">W</span>
            </span>
          </div>
          <span className={`chip ${source === "solar" ? "bg-sun-soft text-sun-ink" : "bg-inner text-ink-2"}`}>
            <span className={`h-2 w-2 rounded-full ${source === "solar" ? "bg-sun" : "bg-grid"}`} />
            {source === "solar" ? "On solar" : "On grid"}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          <Stat label="Today" value={`${day.kwh.toFixed(2)} kWh`} />
          <Stat label="From solar" value={`${day.solarPct}%`} accent />
          <Stat label="Cost so far" value={`${day.cost.toFixed(2)} USDC`} />
        </div>
      </section>

      <section className="card flex flex-col gap-2.5 rounded-[26px] px-[18px]">
        <div className="flex items-center justify-between">
          <span className="text-base font-bold">Today by hour</span>
          <Legend />
        </div>
        <StackBars data={hourly} nowIndex={6} />
        <div className="flex justify-between text-[11px] text-muted">
          <span>6 AM</span>
          <span>Now 12</span>
          <span>6 PM</span>
        </div>
      </section>

      <section className="card flex flex-col gap-3 rounded-[26px] px-[18px]">
        <div className="flex items-center justify-between">
          <span className="flex flex-col gap-0.5">
            <span className="text-base font-bold">Recommended for you</span>
            <span className="mono text-[11px] text-muted">By 0G from the sun forecast · {reqId}</span>
          </span>
        </div>
        {recs.length === 0 && <span className="text-sm text-muted">No tips today. Your use already follows the sun.</span>}
        {recs.map((r) => (
          <div key={r.title} className="inner flex items-center gap-3 rounded-[18px] py-2.5 pl-3 pr-2.5">
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-sun-soft text-sun-ink">
              <Icon name={r.icon} />
            </span>
            <span className="flex flex-1 flex-col gap-0.5">
              <span className="text-sm font-bold">{r.title}</span>
              <span className="text-xs text-muted">{r.why}</span>
            </span>
            <button type="button" className="btn">
              Set
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div className="inner flex flex-col gap-0.5 p-3">
      <span className="text-[11px] text-muted">{label}</span>
      <span className={`whitespace-nowrap text-[16px] font-extrabold ${accent ? "text-sun-ink" : ""}`}>{value}</span>
    </div>
  );
}
