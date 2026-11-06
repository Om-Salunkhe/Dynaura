// Projector mode: the 5 moments of the demo, one big screen each.
// Keys: 1-5 pick a moment, ← → step through, Space runs the moment's next action, H hides the controls.
// With the Pi reachable, actions call its API; without it, the shared demo scene plays the story.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ConnectionDialog, ConnectionPill, MixedContentBanner } from "../components/Connection.jsx";
import HeroSteps from "../components/HeroSteps.jsx";
import Icon from "../components/Icon.jsx";
import OfflineBanner, { SafeStopBanner, isOffline } from "../components/OfflineBanner.jsx";
import Proof from "../components/Proof.jsx";
import { admin as demoAdmin, plan as demoPlan } from "../data/demo.js";
import { planToView } from "../data/society.js";
import { getJSON, postJSON, shortId, useLive } from "../lib/api.js";
import { useHero } from "../lib/hero.js";
import { routingStory, usePlan } from "../lib/plan.js";
import { MOMENTS, setScene, useScene } from "../lib/scene.js";
import { FLATS } from "../lib/role.jsx";

const big = "text-[clamp(52px,6.4vw,130px)] font-medium leading-none tracking-[-2px]";

export default function Demo() {
  const live = useLive();
  const scene = useScene();
  const hero = useHero(live);
  const [controls, setControls] = useState(true);
  const [note, setNote] = useState(null);
  const connected = !live.demo;
  const offline = isOffline(live);
  const idx = Math.max(0, MOMENTS.findIndex((m) => m.key === scene.moment));
  const moment = MOMENTS[idx];

  const run = useCallback(async (label, fn) => {
    setNote({ text: `${label}…` });
    try {
      await fn();
      setNote({ text: `${label}: done`, ok: true });
    } catch (e) {
      setNote({ text: `${label}: ${e.message}`, bad: true });
    }
  }, []);

  // Each moment's buttons. Live = the Pi does it; demo = the scene plays it.
  const actions = {
    morning: [
      ...(connected ? [{ label: "Ask 0G for today's plan", fn: () => postJSON("/api/plan/run?which=today", {}, { admin: true }) }] : []),
    ],
    noon: connected
      ? [
          { label: "Sun out", fn: () => postJSON("/api/moment/sun", {}, { admin: true }) },
          { label: "Flat B away", fn: () => postJSON("/api/moment/away-B", {}, { admin: true }) },
          { label: "Flat B home", fn: () => postJSON("/api/moment/home-B", {}, { admin: true }) },
          { label: "Run the pump", fn: () => postJSON("/api/moment/pump", {}, { admin: true }) },
        ]
      : [],
    dust: [
      { label: hero.live ? "Dust on (SIM)" : "Tracing paper on", fn: hero.actions.dust, when: ["clean", "paid", "refunded", "resolved"] },
      // v3: 0G looks, then the committee approves before any money moves
      ...(hero.v3 && hero.live ? [{ label: "Scan panel (0G)", fn: hero.actions.scan, when: ["clean", "dusty"] }] : []),
      ...(hero.v3 ? [{ label: "Committee approves", fn: () => hero.actions.approve?.(hero.fee), when: ["flagged"] }] : []),
      ...(hero.live ? [] : [{ label: "Cleaner accepts", fn: hero.actions.accept, when: ["open"] }]),
      // Live: only the SIM's own buttons; the Pi and the cleaner's wallet move the escrow, not us
      ...(hero.live
        ? [{ label: "Paper off (SIM)", fn: hero.actions.reset, when: ["dusty", "accepted", "cleaning"] }]
        : [
            { label: "Paper off", fn: hero.actions.done, when: ["accepted"] },
            { label: "Reset", fn: hero.actions.reset, when: ["dusty", "open", "accepted", "cleaning", "paid", "refunded"], quiet: true },
          ]),
    ],
    settle: [
      connected
        ? { label: "Settle the month on Arc", fn: () => postJSON("/api/admin/bills", {}, { admin: true }) }
        : { label: "Settle the month", fn: () => setScene({ settledAt: Date.now() }) },
    ],
    offline: connected ? [] : [{ label: scene.offline ? "0G back online" : "Unplug 0G", fn: () => setScene({ offline: !scene.offline }) }],
  }[moment.key].filter((a) => !a.when || a.when.includes(hero.stage));

  const first = useRef(null);
  first.current = actions[0];
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.("input, textarea, select")) return;
      const n = Number(e.key);
      if (n >= 1 && n <= MOMENTS.length) setScene({ moment: MOMENTS[n - 1].key });
      else if (e.key === "ArrowRight") setScene({ moment: MOMENTS[Math.min(idx + 1, MOMENTS.length - 1)].key });
      else if (e.key === "ArrowLeft") setScene({ moment: MOMENTS[Math.max(idx - 1, 0)].key });
      else if (e.key.toLowerCase() === "h") setControls((c) => !c);
      else if (e.key === " " && first.current) {
        e.preventDefault();
        run(first.current.label, first.current.fn);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idx, run]);

  return (
    <div className="flex min-h-screen flex-col gap-4 px-[3vw] py-[2vw] 2xl:gap-6">
      <header className="flex items-center justify-between gap-6">
        <Link to="/home" className="flex items-center gap-4" title="Back to the app">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[#111418] text-sun">
            <Icon name="sun" size={30} />
          </span>
          <span className="flex flex-col">
            <span className="text-3xl font-medium tracking-[-0.5px]">Dynaura</span>
            <span className="hidden text-lg text-muted 2xl:block">Sunrise Apartments · 0G decides, Arc pays, Arkiv remembers</span>
          </span>
        </Link>
        <nav className="flex gap-2 rounded-full border border-line bg-card p-1.5" aria-label="Moments">
          {MOMENTS.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setScene({ moment: m.key })}
              className={`flex items-center gap-2 rounded-full px-5 py-3 text-lg font-medium ${m.key === moment.key ? "bg-btn text-btn-ink" : "text-muted hover:text-ink"}`}
            >
              <span className="opacity-60">{m.n}</span>
              <span className="hidden 2xl:inline">{m.label}</span>
              <span className="2xl:hidden">{m.short}</span>
            </button>
          ))}
        </nav>
        <ConnectionPill size="xl" />
      </header>

      <MixedContentBanner />
      {offline && moment.key !== "offline" && <OfflineBanner size="strip" />}
      <SafeStopBanner live={live} />

      <main className="flex flex-1 flex-col">
        {moment.key === "morning" && <Morning connected={connected} offline={offline} live={live} />}
        {moment.key === "noon" && <Noon live={live} scene={scene} offline={offline} hero={hero} />}
        {moment.key === "dust" && <Dust hero={hero} />}
        {moment.key === "settle" && <Settle connected={connected} scene={scene} />}
        {moment.key === "offline" && <Offline live={live} scene={scene} offline={offline} hero={hero} />}
      </main>

      {controls && (
        <footer className="flex flex-wrap items-center gap-3">
          {actions.map((a) => (
            <button key={a.label} type="button" className={`${a.quiet ? "btn-ghost" : "btn"} min-h-[56px] px-6 text-lg`} onClick={() => run(a.label, a.fn)}>
              {a.label}
            </button>
          ))}
          {note && <span className={`text-lg ${note.bad ? "text-bad" : note.ok ? "text-good" : "text-muted"}`}>{note.text}</span>}
          <span className="ml-auto text-base text-muted">1–5 moments · ← → · Space next · H hide</span>
        </footer>
      )}
      <ConnectionDialog />
    </div>
  );
}

function Kicker({ n, children }) {
  return (
    <span className="flex items-center gap-3 text-2xl font-medium tracking-wider text-sun-ink">
      <span className="grid h-10 w-10 place-items-center rounded-full bg-sun text-xl text-[#111418]">{n}</span>
      {children}
    </span>
  );
}

const teeLabel = (tee) => {
  const e = Object.entries(tee || {});
  if (!e.length) return null;
  return e.some(([k, v]) => /verif/i.test(k) && v === true) ? "TEE verified" : "TEE data attached";
};

// ---- 1 · Morning plan ------------------------------------------------------
function Morning({ connected, offline, live }) {
  const api = usePlan(connected, 5000);

  const hasPlan = api?.plan && api.mode === "ai";
  const view = hasPlan ? planToView(api, live.runner?.jobs) : demoPlan;
  const win = hasPlan ? api.plan.solar_window : ["10:00", "15:00"];
  const jobs = view.groups.flatMap((g) => g.jobs).sort((a, b) => a.start - b.start).slice(0, 6);
  const tee = hasPlan ? teeLabel(api.tee) : "TEE verified";
  const reqId = hasPlan ? api.request_id : view.requestId;

  if (connected && !hasPlan) {
    // live, but no AI plan: say so; never show the demo plan as if it were real
    return (
      <section className="grid flex-1 grid-cols-[1.1fr_1fr] gap-8">
        <div className="card flex flex-col justify-center gap-8 rounded-[40px] p-7 2xl:p-10">
          <Kicker n={1}>MORNING PLAN</Kicker>
          <span className="text-4xl font-medium leading-tight 2xl:text-5xl">{offline ? "No plan today: 0G can't be reached." : "No 0G plan yet today."}</span>
          <span className="text-2xl text-muted">
            {offline ? "Dyna won't guess. Until 0G answers, every flat stays on grid." : "Press the button and the Pi asks 0G Compute for today's plan."}
          </span>
        </div>
        <div className="card flex flex-col justify-center gap-4 rounded-[40px] p-7 2xl:p-10">
          <span className="text-3xl font-medium">Jobs wait for a plan</span>
          <span className="text-2xl text-muted">Pumps and chargers only move into the sun when Dyna has a plan with a 0G proof behind it.</span>
        </div>
      </section>
    );
  }
  return (
    <section className="grid flex-1 grid-cols-[1.1fr_1fr] gap-8">
      <div className="card flex flex-col justify-between gap-8 rounded-[40px] p-7 2xl:p-10">
        <Kicker n={1}>MORNING PLAN</Kicker>
        <span className="text-4xl font-medium leading-tight 2xl:text-5xl">Dyna planned today's sun on 0G.</span>
        <div className="flex flex-wrap gap-x-14 gap-y-6">
          <span className="flex flex-col gap-2">
            <span className="text-2xl text-muted">Solar window</span>
            <span className={`${big} whitespace-nowrap`}>
              {win[0]}
              <span className="text-muted">–</span>
              {win[1]}
            </span>
          </span>
          <span className="flex flex-col gap-2">
            <span className="text-2xl text-muted">Roof forecast</span>
            <span className={big}>
              {view.forecastKwh}
              <span className="text-4xl text-muted"> kWh</span>
            </span>
          </span>
        </div>
        <span className="flex flex-wrap gap-3 text-xl">
          {reqId && (
            <span className="chip bg-sun-soft px-5 py-2.5 text-xl text-sun-ink">
              <Icon name="spark" size={20} /> 0G Compute · <span className="mono">{shortId(reqId)}</span>
            </span>
          )}
          {tee && (
            <span className="chip bg-[rgba(47,158,106,0.16)] px-5 py-2.5 text-xl text-good">
              <Icon name="check" size={20} /> {tee}
            </span>
          )}
          {hasPlan && api.storage_root && <Proof kind="og" id={api.storage_root} label="0G Storage" className="px-5 py-2.5 text-xl" />}
          {!hasPlan && <span className="chip bg-inner px-5 py-2.5 text-xl text-muted">{connected ? "No 0G plan yet today" : "Demo plan"}</span>}
        </span>
      </div>
      <div className="card flex flex-col gap-4 rounded-[40px] p-7 2xl:p-10">
        <span className="text-3xl font-medium">Jobs moved into the sun</span>
        {jobs.map((j) => (
          <div key={j.name} className="inner flex items-center justify-between gap-4 px-6 py-5">
            <span className="flex items-center gap-4">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-sun-soft text-sun-ink">
                <Icon name={j.icon} size={24} />
              </span>
              <span className="text-2xl font-medium">{j.name}</span>
            </span>
            <span className={`text-2xl font-medium ${j.running ? "text-good" : "text-ink-2"}`}>{j.label}</span>
          </div>
        ))}
        <span className="mt-auto text-xl text-muted">Lifts, corridor lights and CCTV always stay on grid.</span>
      </div>
    </section>
  );
}

// ---- the building, big -----------------------------------------------------
function demoBuilding(live, scene, hero, offline) {
  if (!live.demo) return { panelW: live.meters?.panel?.w ?? 0, flats: live.flats || {}, meters: live.meters || {}, pump: live.pump?.on };
  const flats = {
    A: { source: offline ? "grid" : "solar", away: false },
    B: { source: "grid", away: true },
    C: { source: offline ? "grid" : "solar", away: false },
  };
  // nothing draws from the panel while every flat is on grid, so its meter reads ~0
  const panelW = offline ? 0 : scene.moment === "dust" ? 2.1 * (hero.pct / 100) : live.meters.panel.w;
  return { panelW, flats, meters: live.meters, pump: true, timer: offline };
}

function Building({ b, caption }) {
  return (
    <div className="card flex flex-col gap-3 rounded-[40px] p-7 2xl:gap-4 2xl:p-10">
      <div className="flex items-center justify-between rounded-3xl bg-sun-soft px-8 py-4 2xl:py-6">
        <span className="flex items-center gap-4 text-3xl font-medium">
          <Icon name="panel" size={36} /> Roof panel
        </span>
        <span className="text-5xl font-medium text-sun-ink">{(b.panelW || 0).toFixed(2)} W</span>
      </div>
      {["C", "B", "A"].map((f) => {
        const st = b.flats[f] || {};
        const solar = st.source === "solar";
        return (
          <div
            key={f}
            className={`flex items-center justify-between rounded-3xl border-4 px-8 py-4 2xl:py-6 ${
              st.away ? "border-line bg-inner opacity-60" : solar ? "border-sun bg-sun-soft" : "border-grid bg-[rgba(110,155,255,0.14)]"
            }`}
          >
            <span className="flex items-center gap-4">
              <span className={`h-6 w-6 rounded-full ${solar ? "bg-sun" : "bg-grid"}`} />
              <span className="whitespace-nowrap text-3xl font-medium 2xl:text-4xl">{FLATS[f].name}</span>
              <span className="hidden text-2xl text-muted 2xl:inline">{FLATS[f].floor}</span>
            </span>
            <span className="flex items-center gap-4">
              {st.away && <span className="chip bg-card-solid px-4 py-2 text-xl">Away</span>}
              <span className={`text-3xl font-medium ${solar ? "text-sun-ink" : "text-link"}`}>{solar ? "SOLAR" : "GRID"}</span>
              <span className="w-28 text-right text-2xl text-muted">{(b.meters?.[f]?.w ?? 0).toFixed(2)} W</span>
            </span>
          </div>
        );
      })}
      <div className="flex items-center justify-between rounded-3xl bg-inner px-8 py-4 text-2xl 2xl:py-5">
        <span className="flex items-center gap-4 font-medium">
          <Icon name="water" size={28} /> Overhead tank pump
        </span>
        <span className="font-medium">{b.timer ? "ON · safety timer" : b.pump ? "ON · on solar" : "OFF"}</span>
      </div>
      {caption && <span className="text-2xl text-muted">{caption}</span>}
    </div>
  );
}

// ---- 2 · Noon routing -------------------------------------------------------
function Noon({ live, scene, offline, hero }) {
  const b = demoBuilding(live, scene, hero, offline);
  const onSolar = Object.entries(b.flats).filter(([, s]) => s.source === "solar").map(([f]) => f);
  const story = routingStory(live, usePlan(!live.demo));
  return (
    <section className="grid flex-1 grid-cols-[1fr_1.2fr] gap-8">
      <div className="card flex flex-col gap-8 rounded-[40px] p-7 2xl:p-10">
        <Kicker n={2}>NOON ROUTING</Kicker>
        <span className="text-4xl font-medium leading-tight 2xl:text-5xl">
          {offline && !onSolar.length ? "No AI, no solar switching: every flat is on grid." : story.text}
        </span>
        {story.reason && (
          <span className="flex flex-col gap-2 rounded-3xl bg-sun-soft px-6 py-4">
            <span className="text-xl font-medium tracking-wider text-sun-ink">DYNA'S REASON · 0G {shortId(story.requestId)}</span>
            <span className="text-2xl">“{story.reason}”</span>
          </span>
        )}
        <span className="flex flex-col gap-2">
          <span className="text-2xl text-muted">Flats on solar right now</span>
          <span className={big}>{onSolar.length ? onSolar.join(" + ") : "none"}</span>
        </span>
        <span className="text-2xl text-muted">The pump runs in the plan's sunny slot, so the tank fills on free power.</span>
      </div>
      <Building b={b} caption="Yellow LED = solar · blue LED = grid. Every switch is metered and written to Arkiv." />
    </section>
  );
}

// ---- 3 · Dust (the hero) -----------------------------------------------------
function Dust({ hero }) {
  const pct = hero.pct != null ? Math.round(hero.pct) : null;
  const dusty = pct != null && pct < hero.dustPct;
  const paid = hero.stage === "paid";
  const ring = paid ? "--good" : dusty ? "--bad" : "--sun";
  return (
    <section className="grid flex-1 grid-cols-[1fr_1.15fr] gap-8">
      <div className="card flex flex-col items-center justify-center gap-8 rounded-[40px] p-7 2xl:p-10">
        <Kicker n={3}>DUSTY PANEL</Kicker>
        <div
          className="relative grid aspect-square w-[min(30vw,40vh,460px)] place-items-center rounded-full transition-[background] duration-300"
          style={{ background: `conic-gradient(var(${ring}) 0 ${pct ?? 0}%, var(--idle) ${pct ?? 0}% 100%)` }}
        >
          {/* alert line at dustPct, clean line at cleanPct */}
          {[
            [hero.dustPct, "bg-bad"],
            [hero.cleanPct, "bg-good"],
          ].map(([p, c]) => (
            <span key={p} className="absolute inset-0" style={{ transform: `rotate(${p * 3.6}deg)` }}>
              <span className={`absolute left-1/2 top-0 h-[12%] w-1.5 -translate-x-1/2 rounded-full ${c}`} />
            </span>
          ))}
          <div className="grid h-[80%] w-[80%] place-items-center rounded-full bg-card-solid text-center">
            <span className="flex flex-col items-center">
              <span className="text-[clamp(64px,8vw,140px)] font-medium leading-none">{pct ?? "–"}%</span>
              <span className="text-2xl text-muted">of a clean panel</span>
            </span>
          </div>
        </div>
        <div className="grid w-full grid-cols-2 gap-4">
          <span className="inner flex flex-col gap-1 px-6 py-4">
            <span className="text-xl text-muted">Expected now</span>
            <span className="text-4xl font-medium">{hero.expectedW != null ? `${hero.expectedW.toFixed(2)} W` : "–"}</span>
          </span>
          <span className="inner flex flex-col gap-1 px-6 py-4">
            <span className="text-xl text-muted">Actual now</span>
            <span className={`text-4xl font-medium ${dusty ? "text-bad" : ""}`}>{hero.actualW != null ? `${hero.actualW.toFixed(2)} W` : "–"}</span>
          </span>
        </div>
        <span className="text-xl text-muted [@media(max-height:820px)]:hidden">
          Alert under {hero.dustPct}% · pays at {hero.cleanPct}%+
        </span>
      </div>
      <div className="card flex flex-col justify-center gap-6 rounded-[40px] p-7 2xl:p-10">
        {paid ? (
          <span className="flex flex-col gap-1 rounded-3xl bg-[rgba(47,158,106,0.16)] px-8 py-6 [@media(max-height:820px)]:py-3">
            <span className="text-2xl font-medium tracking-wider text-good">PAID BY THE SUN</span>
            <span className="text-4xl font-medium 2xl:text-5xl [@media(max-height:820px)]:text-3xl">{hero.job.fee.toFixed(2)} USDC to {hero.job.cleaner?.startsWith?.("0x") ? shortId(hero.job.cleaner) : hero.job.cleaner || "the cleaner"}</span>
          </span>
        ) : (
          <span className="text-3xl font-medium leading-tight 2xl:text-4xl">
            {hero.stage === "clean" ? "Tracing paper goes on the panel…" : "0G sees the dust, the committee approves, the meter decides the payout."}
          </span>
        )}
        <HeroSteps hero={hero} size="xl" />
        {hero.error && hero.live && <span className="text-lg text-bad">Pi: {hero.error}</span>}
        {hero.live && !hero.arc && <span className="text-lg text-muted">Arc escrow isn't set up on the Pi, so no job opens.</span>}
      </div>
    </section>
  );
}

// ---- 4 · Month-end settle ----------------------------------------------------
function Settle({ connected, scene }) {
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

  const rows = bills
    ? bills.map((b) => ({ flat: b.flat, kwh: b.solar_kwh + b.grid_kwh, solarPct: b.solar_pct, usdc: b.usdc, posted: b.bill_id > 0, paid: b.paid }))
    : demoAdmin.flats.map((f) => ({ flat: f.id, kwh: f.kwh, solarPct: f.solarPct, usdc: f.usdc, posted: !!scene.settledAt, paid: false, note: f.note }));
  const total = rows.reduce((s, r) => s + r.usdc, 0);
  return (
    <section className="grid flex-1 grid-cols-[1fr_1.3fr] gap-8">
      <div className="card flex flex-col gap-8 rounded-[40px] p-7 2xl:p-10">
        <Kicker n={4}>MONTH-END SETTLE</Kicker>
        <span className="text-4xl font-medium leading-tight 2xl:text-5xl">Each flat pays for what its own meter measured.</span>
        <span className="flex flex-col gap-2">
          <span className="text-2xl text-muted">The building's bill this month</span>
          <span className={big}>
            {total.toFixed(2)}
            <span className="text-4xl text-muted"> USDC</span>
          </span>
        </span>
        <span className="text-2xl text-muted">Plain arithmetic, no AI: kWh from the signed meter readings × the committee's rates. Posted on Arc, paid in USDC.</span>
      </div>
      <div className="card flex flex-col gap-4 rounded-[40px] p-7 2xl:p-10">
        {rows.map((r) => (
          <div key={r.flat} className="inner flex items-center justify-between gap-6 px-8 py-6">
            <span className="flex flex-col gap-1">
              <span className="text-4xl font-medium">{FLATS[r.flat].name}</span>
              <span className="text-2xl text-muted">
                {r.kwh.toFixed(1)} kWh · {r.solarPct}% solar{r.note ? ` · ${r.note}` : ""}
              </span>
            </span>
            <span className="flex flex-col items-end gap-2">
              <span className="text-5xl font-medium">{r.usdc.toFixed(2)}</span>
              <span className={`chip px-4 py-1.5 text-lg ${r.paid ? "bg-[rgba(47,158,106,0.16)] text-good" : r.posted ? "bg-sun-soft text-sun-ink" : "bg-card-solid text-muted"}`}>
                {r.paid ? "Paid on Arc" : r.posted ? (connected ? "Posted on Arc" : "Posted · demo") : "Not posted yet"}
              </span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---- 5 · 0G offline ------------------------------------------------------------
function Offline({ live, scene, offline, hero }) {
  const b = demoBuilding(live, scene, hero, offline);
  return (
    <section className="grid flex-1 grid-cols-[1.2fr_1fr] gap-8">
      <div className="flex flex-col gap-6">
        {!offline && <Kicker n={5}>0G OFFLINE</Kicker>}
        {offline ? (
          <OfflineBanner size="xl" />
        ) : (
          <div className="card flex flex-col gap-6 rounded-[40px] p-7 2xl:p-10">
            <span className="text-4xl font-medium leading-tight 2xl:text-5xl">0G is online. Unplug the internet to see what happens.</span>
            <span className="text-2xl text-muted">
              Without Dyna the Pi never guesses: every flat drops to grid, the pump runs on its safety timer, and no decision is made without a proof.
            </span>
          </div>
        )}
      </div>
      <Building b={b} caption={offline ? "Every flat is on grid (blue). Nothing waits on the AI." : null} />
    </section>
  );
}
