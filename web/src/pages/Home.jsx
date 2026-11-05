import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import DemoBadge from "../components/DemoBadge.jsx";
import Icon from "../components/Icon.jsx";
import Legend from "../components/Legend.jsx";
import PageHeader from "../components/PageHeader.jsx";
import AccountButton from "../components/AccountButton.jsx";
import StackBars from "../components/StackBars.jsx";
import { bill, hourly, plan as demoPlan, recommendations, timeline, today } from "../data/demo.js";
import { planToView } from "../data/society.js";
import { shortId, useLive, usePi } from "../lib/api.js";
import { fetchDecisions, useArkiv } from "../lib/arkiv.js";
import { FLATS, useRole } from "../lib/role.jsx";

const HOURS = ["6", "7", "8", "9", "10", "11", "12", "1", "2", "3", "4", "5 PM"];
const NOW = 6; // index of the current hour in the demo bars

export default function Home() {
  const [who] = useRole();
  const flat = FLATS[who.flat];
  const live = useLive();
  const api = usePi("/api/plan", null);
  const livePlan = !api.demo && api.data?.plan;
  const recs = livePlan ? api.data.plan.recommendations?.[flat.id] ?? [] : recommendations;
  const reqId = livePlan ? shortId(api.data.request_id) : demoPlan.requestId;
  const dateText = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  return (
    <div className="flex flex-col gap-3 lg:gap-5">
      {/* Phone header */}
      <div className="flex flex-col gap-3 lg:hidden">
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
        <AskBar />
      </div>

      {/* Desktop header */}
      <header className="hidden items-center justify-between gap-6 lg:flex">
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] text-muted">
            {flat.name} · Sunrise Apartments · {dateText}
          </span>
          <h1 className="h-title m-0">Your energy</h1>
        </div>
        <div className="flex w-full max-w-[480px] items-center gap-2">
          <AskBar big />
          <AccountButton />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12 lg:gap-5">
        <UsingNow flat={flat} live={live} className="lg:col-span-5" />
        <HourChart className="lg:col-span-7" />
        <Schedule api={api} className="hidden lg:col-span-7 lg:flex" />
        <Recommended recs={recs} reqId={reqId} className="lg:col-span-5" />
        <BuildingNow live={live} me={flat.id} className="hidden lg:col-span-4 lg:flex" />
        <BillCard className="hidden lg:col-span-4 lg:flex" />
        <RecentArkiv className="hidden lg:col-span-4 lg:flex" />
      </div>
    </div>
  );
}

function AskBar({ big }) {
  return (
    <Link
      to="/ask"
      className={`flex flex-1 items-center gap-2.5 rounded-full border border-line bg-card pl-4 pr-1.5 text-sm text-muted ${
        big ? "min-h-[56px] py-2" : "min-h-[44px] py-1.5"
      }`}
    >
      <Icon name="spark" size={18} className="text-sun-ink" />
      <span className="flex-1">Ask Dyna about your power…</span>
      <span className={`flex items-center justify-center rounded-full bg-btn text-btn-ink ${big ? "h-10 w-10" : "h-9 w-9"}`}>
        <Icon name="arrowRight" size={16} stroke={2.4} />
      </span>
    </Link>
  );
}

function UsingNow({ flat, live, className = "" }) {
  const meter = live.meters?.[flat.id];
  const source = live.flats?.[flat.id]?.source ?? "grid";
  const day = today[flat.id];
  return (
    <section className={`card flex flex-col gap-4 rounded-[26px] p-[18px] lg:justify-between lg:p-6 ${className}`}>
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-2 text-[13px] text-muted">
            Using right now <DemoBadge demo={live.demo} />
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="text-[46px] font-extrabold leading-none tracking-[-1.5px] lg:text-[56px]">{(meter?.w ?? 0).toFixed(2)}</span>
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
  );
}

function HourChart({ className = "" }) {
  return (
    <section className={`card flex flex-col gap-2.5 rounded-[26px] px-[18px] lg:p-6 ${className}`}>
      <div className="flex items-center justify-between">
        <span className="text-base font-bold lg:text-lg">Today by hour</span>
        <Legend />
      </div>
      <div className="lg:hidden">
        <StackBars data={hourly} nowIndex={NOW} />
        <div className="mt-2 flex justify-between text-[11px] text-muted">
          <span>6 AM</span>
          <span>Now 12</span>
          <span>6 PM</span>
        </div>
      </div>
      <div className="hidden flex-1 flex-col justify-end gap-2 pt-4 lg:flex">
        <StackBars data={hourly} nowIndex={NOW} height={140} gap={10} />
        <div className="grid text-center text-[11px] text-muted" style={{ gridTemplateColumns: `repeat(${HOURS.length}, minmax(0,1fr))`, columnGap: 10 }}>
          {HOURS.map((h, i) => (
            <span key={h} className={i === NOW ? "font-extrabold text-ink" : ""}>
              {i === NOW ? "Now" : h}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

const GROUP_COLOR = { Water: "bg-[#2F9E6A]", Charging: "bg-grid", Upkeep: "bg-[#A57BEA]" };
const GROUP_INK = { Water: "text-[#2F9E6A]", Charging: "text-muted", Upkeep: "text-muted" };
const S0 = 9; // 9 AM
const S1 = 15; // 3 PM
const pct = (h) => ((h - S0) / (S1 - S0)) * 100;

function Schedule({ api, className = "" }) {
  const [view, setView] = useState(demoPlan);
  const live = !api.demo && api.data?.plan;
  useEffect(() => {
    if (live) setView(planToView(api.data, api.data.runner?.jobs));
  }, [api.data, live]);
  const jobs = view.groups.flatMap((g) => g.jobs.map((j) => ({ ...j, group: g.name }))).slice(0, 5);

  return (
    <section className={`card flex-col gap-3 rounded-[26px] p-6 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <span className="flex flex-col gap-0.5">
          <span className="text-lg font-bold">Society schedule</span>
          <span className="text-[13px] text-muted">Common-area jobs 0G placed in {live ? view.date : "tomorrow"}'s peak sun</span>
        </span>
        <Link to="/society" className="chip border border-line bg-card-solid py-1.5 text-xs font-semibold">
          <Icon name="lock" size={14} /> Set by committee
        </Link>
      </div>
      <div className="grid grid-cols-[150px_1fr] gap-3 text-[11px] text-muted">
        <span />
        <span className="flex justify-between">
          <span>9 AM</span>
          <span>11</span>
          <span>1 PM</span>
          <span>3 PM</span>
        </span>
      </div>
      {jobs.map((j) => (
        <div key={j.name} className="grid grid-cols-[150px_1fr] items-center gap-3">
          <span className="flex flex-col leading-tight">
            <span className="text-[15px] font-bold">{j.name}</span>
            <span className={`text-[11px] ${j.running ? `font-bold ${GROUP_INK[j.group] || "text-sun-ink"}` : "text-muted"}`}>
              {j.group} · {j.running ? "running now" : j.label}
            </span>
          </span>
          <span className="relative h-7 overflow-hidden rounded-lg bg-inner">
            <span className="absolute inset-y-0 bg-sun-soft" style={{ left: `${pct(10)}%`, width: `${pct(14) - pct(10)}%` }} />
            <span
              className={`absolute bottom-1 top-1 rounded-md ${GROUP_COLOR[j.group] || "bg-sun"}`}
              style={{ left: `${pct(j.start)}%`, width: `${Math.max(pct(S0 + j.hours), 4)}%` }}
            />
          </span>
        </div>
      ))}
      <p className="mt-auto border-t border-line pt-3 text-xs text-muted">
        Lifts, corridor lights and CCTV always stay on grid. Only the committee admin can change jobs.
      </p>
    </section>
  );
}

function Recommended({ recs, reqId, className = "" }) {
  return (
    <section className={`card flex flex-col gap-3 rounded-[26px] px-[18px] lg:p-6 ${className}`}>
      <span className="flex flex-col gap-0.5">
        <span className="text-base font-bold lg:text-lg">Recommended for you</span>
        <span className="text-xs text-muted">By 0G from tomorrow's sun · {reqId}</span>
      </span>
      {recs.length === 0 && <span className="text-sm text-muted">No tips today. Your use already follows the sun.</span>}
      {recs.map((r) => (
        <div key={r.title} className="inner flex items-center gap-3 rounded-[18px] py-2.5 pl-3 pr-2.5 lg:py-3 lg:pl-4">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-sun-soft text-sun-ink lg:hidden">
            <Icon name={r.icon} />
          </span>
          <span className="flex flex-1 flex-col gap-0.5">
            <span className="text-sm font-bold lg:text-[15px]">{r.title}</span>
            <span className="text-xs text-muted">{r.why}</span>
          </span>
          <button type="button" className="btn">
            Set
          </button>
        </div>
      ))}
    </section>
  );
}

function BuildingNow({ live, me, className = "" }) {
  const rows = [
    ["C", "2nd · Flat C"],
    ["B", "1st · Flat B"],
    ["A", "Ground · Flat A"],
  ];
  return (
    <section className={`card flex-col rounded-[26px] p-6 ${className}`}>
      <span className="pb-2 text-lg font-bold">Building now</span>
      <Row k="Roof panel" v={`${(live.meters?.panel?.w ?? 0).toFixed(2)} W`} />
      {rows.map(([id, label]) => {
        const f = live.flats?.[id] || {};
        const w = (live.meters?.[id]?.w ?? 0).toFixed(2);
        const v = f.away ? "Away · shared to others" : f.source === "solar" ? `Solar · ${w} W` : `Grid · ${w} W`;
        return (
          <Row
            key={id}
            k={`${label}${id === me ? " (you)" : ""}`}
            v={v}
            tone={f.away ? "text-muted" : f.source === "solar" ? "text-sun-ink" : "text-ink-2"}
          />
        );
      })}
    </section>
  );
}

function Row({ k, v, tone = "" }) {
  return (
    <div className="flex items-center justify-between border-b border-line py-3 text-sm last:border-0">
      <span>{k}</span>
      <span className={`font-bold ${tone}`}>{v}</span>
    </div>
  );
}

function BillCard({ className = "" }) {
  return (
    <section className={`card flex-col gap-2 rounded-[26px] p-6 ${className}`}>
      <span className="text-lg font-bold">{bill.month} bill</span>
      <span className="flex items-baseline gap-1.5 pt-2">
        <span className="text-[44px] font-extrabold leading-none tracking-[-1.5px]">{bill.owe.toFixed(2)}</span>
        <span className="text-base text-muted">USDC</span>
      </span>
      <span className="text-[13px] font-semibold text-[#2F9E6A]">Includes {bill.credit.toFixed(2)} credit for sharing</span>
      <Link to="/bill" className="btn mt-auto min-h-[52px] rounded-2xl text-[15px]">
        Pay on Arc
      </Link>
    </section>
  );
}

function RecentArkiv({ className = "" }) {
  const dec = useArkiv(() => fetchDecisions(3), null);
  const items = dec.live && dec.data?.length
    ? dec.data.map((d) => ({ when: `${d.day} · ${d.kind === "plan" ? "AI decision" : d.kind}`, text: d.summary, proof: d.requestId ? "0G proof" : "Arkiv" }))
    : timeline.slice(0, 3).map((t) => ({ when: `${t.when} · ${t.title}`, text: t.text, proof: t.proof.startsWith("0G") ? "0G proof" : "Arc tx" }));
  return (
    <section className={`card flex-col rounded-[26px] p-6 ${className}`}>
      <span className="pb-2 text-lg font-bold">Recent on Arkiv</span>
      {items.map((t) => (
        <Link key={t.when + t.text} to="/history" className="flex flex-col gap-0.5 border-b border-line py-2.5 last:border-0">
          <span className="text-[11px] text-muted">{t.when}</span>
          <span className="line-clamp-1 text-sm font-bold">{t.text}</span>
          <span className="text-[11px] font-bold text-link">{t.proof}</span>
        </Link>
      ))}
    </section>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div className="inner flex flex-col gap-0.5 p-3">
      <span className="text-[11px] text-muted">{label}</span>
      <span className={`whitespace-nowrap text-[16px] font-extrabold lg:text-lg ${accent ? "text-sun-ink" : ""}`}>{value}</span>
    </div>
  );
}
