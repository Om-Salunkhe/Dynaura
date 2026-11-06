import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import DemoBadge from "../components/DemoBadge.jsx";
import Icon from "../components/Icon.jsx";
import Legend from "../components/Legend.jsx";
import PageHeader from "../components/PageHeader.jsx";
import StackBars from "../components/StackBars.jsx";
import { bill, hourly, plan as demoPlan, recommendations, timeline, today } from "../data/demo.js";
import { planToView } from "../data/society.js";
import { shortId, useLive, usePi } from "../lib/api.js";
import { panelVolts, panelWatts } from "../lib/panel.js";
import { planStatus } from "../lib/plan.js";
import { fetchDecisions, useArkiv } from "../lib/arkiv.js";
import { FLATS, useRole } from "../lib/role.jsx";

const HOURS = ["6", "7", "8", "9", "10", "11", "12", "1", "2", "3", "4", "5 PM"];
const NOW = 6; // index of the current hour in the demo bars

export default function Home() {
  const [who] = useRole();
  const flat = FLATS[who.flat];
  const live = useLive();
  const api = usePi("/api/plan", null);
  const ps = planStatus(api, live);
  const livePlan = ps.mode === "ai";
  // a live Pi without an AI plan shows nothing from 0G, never the demo tips
  const recs = livePlan ? api.data.plan.recommendations?.[flat.id] ?? [] : ps.mode === "demo" ? recommendations : [];
  const reqId = livePlan ? shortId(api.data.request_id) : ps.mode === "demo" ? demoPlan.requestId : null;
  const dateText = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  return (
    <div className="flex flex-col gap-3 lg:gap-4">
      {/* Phone header */}
      <div className="flex flex-col gap-3 lg:hidden">
        <PageHeader
          kicker={`${flat.name} · ${flat.floor}`}
          title="Your energy"
        />
        <AskBar />
      </div>

      {/* Desktop header */}
      <header className="hidden items-center justify-between gap-6 lg:flex">
        <div className="flex flex-col gap-0.5">
          <span className="text-[12.5px] text-muted">
            {flat.name} · Sunrise Apartments · {dateText}
          </span>
          <h1 className="h-title m-0">Your energy</h1>
        </div>
        <div className="flex w-full max-w-[460px] items-center gap-2">
          <AskBar big />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12 lg:gap-4">
        <UsingNow flat={flat} live={live} className="lg:col-span-5" />
        <HourChart className="lg:col-span-7" />
        <Schedule api={api} ps={ps} className="hidden lg:col-span-7 lg:flex" />
        <Recommended recs={recs} reqId={reqId} ps={ps} className="lg:col-span-5" />
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
      className={`flex flex-1 items-center gap-2.5 rounded-[12px] border border-line bg-card pl-3.5 pr-1.5 text-[13.5px] text-muted shadow-nav transition-colors hover:border-[color:var(--muted)] ${
        big ? "min-h-[48px] py-1.5" : "min-h-[44px] py-1.5"
      }`}
    >
      <Icon name="spark" size={17} className="text-sun-ink" />
      <span className="flex-1 truncate">Ask Dyna about your power…</span>
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[8px] bg-btn text-btn-ink">
        <Icon name="arrowRight" size={15} stroke={2} />
      </span>
    </Link>
  );
}

function UsingNow({ flat, live, className = "" }) {
  const meter = live.meters?.[flat.id];
  const source = live.flats?.[flat.id]?.source ?? "grid";
  const day = today[flat.id];
  return (
    <section className={`card hero relative flex flex-col gap-5 overflow-hidden p-[18px] lg:justify-between lg:p-6 ${className}`}>
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-2 text-[12.5px] text-muted">
            Roof panel generating <DemoBadge demo={live.demo} />
          </span>
          <span className="flex items-baseline gap-1.5 pt-1">
            <span className="num text-[52px] font-light leading-none lg:text-[68px]">{panelVolts(live)}</span>
            <span className="text-[15px] text-muted">V</span>
          </span>
          <span className="num text-[12.5px] text-muted">
            {panelWatts(live)} W of sun · your flat uses {(meter?.w ?? 0).toFixed(2)} W
          </span>
        </div>
        <span className={`chip flex-none border ${source === "solar" ? "border-transparent bg-sun-soft text-sun-ink" : "border-line bg-card-solid text-ink-2"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${source === "solar" ? "bg-sun" : "bg-grid"}`} />
          {source === "solar" ? "On solar" : "On grid"}
        </span>
      </div>
      <div className="grid grid-cols-3 divide-x divide-[color:var(--line)] rounded-[10px] border border-line bg-card-solid">
        <Stat label="Today" value={`${day.kwh.toFixed(2)} kWh`} />
        <Stat label="From solar" value={`${day.solarPct}%`} accent />
        <Stat label="Cost so far" value={`${day.cost.toFixed(2)} USDC`} />
      </div>
    </section>
  );
}

function HourChart({ className = "" }) {
  return (
    <section className={`card flex flex-col gap-2.5 rounded-[14px] px-[18px] lg:p-6 ${className}`}>
      <div className="flex items-center justify-between">
        <span className="text-[15px] font-medium">Today by hour</span>
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
            <span key={h} className={i === NOW ? "font-medium text-ink" : ""}>
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

function Schedule({ api, ps, className = "" }) {
  const [view, setView] = useState(demoPlan);
  const live = ps?.mode === "ai";
  useEffect(() => {
    if (live) setView(planToView(api.data, api.data.runner?.jobs));
  }, [api.data, live]);
  const jobs = view.groups.flatMap((g) => g.jobs.map((j) => ({ ...j, group: g.name }))).slice(0, 5);
  if (ps?.mode === "none")
    return (
      <section className={`card flex-col gap-2 rounded-[14px] p-6 ${className}`}>
        <span className="text-[15px] font-medium">Society schedule</span>
        <span className="text-[13px] text-muted">{ps.why}. Pumps and chargers wait for a plan; nothing is guessed.</span>
      </section>
    );

  return (
    <section className={`card flex-col gap-3 rounded-[14px] p-6 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <span className="flex flex-col gap-0.5">
          <span className="text-[15px] font-medium">Society schedule</span>
          <span className="text-[13px] text-muted">Common-area jobs 0G placed in {live ? view.date : "tomorrow"}'s peak sun</span>
        </span>
        <Link to="/society" className="chip flex-none border border-line bg-card-solid text-ink-2">
          <Icon name="lock" size={13} /> Set by committee
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
            <span className="text-[13.5px] font-medium">{j.name}</span>
            <span className={`text-[11px] ${j.running ? `font-medium ${GROUP_INK[j.group] || "text-sun-ink"}` : "text-muted"}`}>
              {j.group} · {j.running ? "running now" : j.label}
            </span>
          </span>
          <span className="relative h-5 overflow-hidden rounded-[4px]">
            <span className="absolute inset-y-0 bg-sun-soft opacity-70" style={{ left: `${pct(10)}%`, width: `${pct(14) - pct(10)}%` }} />
            <span className="absolute inset-x-0 top-1/2 h-px bg-line" />
            <span
              className={`absolute top-1/2 h-[4px] -translate-y-1/2 rounded-full ${GROUP_COLOR[j.group] || "bg-sun"}`}
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

function Recommended({ recs, reqId, ps, className = "" }) {
  return (
    <section className={`card flex flex-col gap-3 rounded-[14px] px-[18px] lg:p-6 ${className}`}>
      <span className="flex flex-col gap-0.5">
        <span className="text-[15px] font-medium">Recommended for you</span>
        <span className="text-xs text-muted">
          {ps?.mode === "none" ? (
            ps.why
          ) : (
            <>
              {ps?.mode === "demo" ? "Demo · " : ""}By 0G from tomorrow's sun · <span className="mono text-[11px]">{reqId}</span>
            </>
          )}
        </span>
      </span>
      {recs.length === 0 && (
        <span className="text-sm text-muted">{ps?.mode === "none" ? "No tips without a 0G plan. Dyna won't guess." : "No tips today. Your use already follows the sun."}</span>
      )}
      {recs.map((r) => (
        <div key={r.title} className="flex items-center gap-3 rounded-[10px] border border-line bg-card-solid py-2.5 pl-3 pr-2 lg:pl-3.5">
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[8px] bg-sun-soft text-sun-ink">
            <Icon name={r.icon} size={16} />
          </span>
          <span className="flex flex-1 flex-col gap-0.5">
            <span className="text-sm font-medium lg:text-[15px]">{r.title}</span>
            <span className="text-xs text-muted">{r.why}</span>
          </span>
          <button type="button" className="btn-ghost min-h-[34px] px-3 text-[12.5px]">
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
    <section className={`card flex-col rounded-[14px] p-6 ${className}`}>
      <span className="pb-2 text-[15px] font-medium">Building now</span>
      <Row
        k="Roof panel"
        v={
          <>
            {panelVolts(live)} V <span className="text-[11px] font-normal text-muted">· {panelWatts(live)} W</span>
          </>
        }
      />
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
    <div className="flex items-center justify-between gap-3 border-b border-line py-2.5 text-[13px] last:border-0">
      <span className="text-ink-2">{k}</span>
      <span className={`num font-medium ${tone}`}>{v}</span>
    </div>
  );
}

function BillCard({ className = "" }) {
  return (
    <section className={`card flex-col gap-2 rounded-[14px] p-6 ${className}`}>
      <span className="text-[15px] font-medium">{bill.month} bill</span>
      <span className="flex items-baseline gap-1.5 pt-2">
        <span className="num text-[40px] font-light leading-none">{bill.owe.toFixed(2)}</span>
        <span className="text-base text-muted">USDC</span>
      </span>
      <span className="text-[13px] font-medium text-[#2F9E6A]">Includes {bill.credit.toFixed(2)} credit for sharing</span>
      <Link to="/bill" className="btn mt-auto">
        Pay on Arc
      </Link>
    </section>
  );
}

function RecentArkiv({ className = "" }) {
  const dec = useArkiv(() => fetchDecisions(3), null);
  const items = dec.live && dec.data?.length
    ? dec.data.map((d) => ({ when: `${d.day} · ${d.kind === "plan" ? "AI decision" : d.kind}`, text: d.summary, proof: d.requestId ? "0G proof" : "Arkiv" }))
    : timeline.slice(0, 3).map((t) => ({ when: `${t.when} · ${t.title}`, text: t.text, proof: `${t.proof.startsWith("0G") ? "0G proof" : "Arc tx"} · demo` }));
  return (
    <section className={`card flex-col rounded-[14px] p-6 ${className}`}>
      <span className="pb-2 text-[15px] font-medium">Recent on Arkiv</span>
      {items.map((t) => (
        <Link key={t.when + t.text} to="/history" className="flex flex-col gap-0.5 border-b border-line py-2.5 last:border-0">
          <span className="text-[11px] text-muted">{t.when}</span>
          <span className="line-clamp-1 text-[13px] font-medium">{t.text}</span>
          <span className="mono text-[10.5px] text-link">{t.proof}</span>
        </Link>
      ))}
    </section>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-3 py-2.5 lg:px-4 lg:py-3">
      <span className="truncate text-[11.5px] text-muted">{label}</span>
      <span className={`num truncate text-[15px] font-medium lg:text-[17px] ${accent ? "text-sun-ink" : ""}`}>{value}</span>
    </div>
  );
}
