// Twin projector (/demo): light, one building, one big number with its comparison. Body ≥ 24 px,
// strokes ≥ 2 px, no axes. Same controls and keys as the current /demo (lib/stage.js).
import { Link } from "react-router-dom";
import { ConnectionDialog, ConnectionPill, MixedContentBanner } from "../components/Connection.jsx";
import { SafeStopBanner } from "../components/OfflineBanner.jsx";
import { plan as demoPlan } from "../data/demo.js";
import { planToView } from "../data/society.js";
import { useLive } from "../lib/api.js";
import { useHero } from "../lib/hero.js";
import { routingStory, usePlan } from "../lib/plan.js";
import { MOMENTS, setScene, useScene } from "../lib/scene.js";
import { useProjector } from "../lib/stage.js";
import BuildingTwin from "./BuildingTwin.jsx";
import EscrowStrip from "./EscrowStrip.jsx";
import Receipt from "./Receipt.jsx";
import { heroReceipts, statusLine, statusTag, twinBuilding, twinPanel, useBills } from "./data.js";
import { SCALE_NOTE, inr, kw, usdc } from "./format.js";

export default function TwinDemo() {
  const live = useLive();
  const scene = useScene();
  const hero = useHero(live);
  const { connected, offline, moment, actions, run, note, controls } = useProjector(live, scene, hero);
  const b = twinBuilding(live);

  return (
    <div className="flex min-h-screen flex-col gap-[2vh] px-[3.2vw] py-[3vh]" style={{ background: "var(--t-bg)", color: "var(--t-ink)" }}>
      <header className="flex items-center justify-between gap-8">
        <Link to="/" className="flex items-baseline gap-4" title="Back to the app">
          <span className="text-[30px] font-semibold tracking-[-0.01em]">Dynaura</span>
          <span className="hidden text-[22px] 2xl:inline" style={{ color: "var(--t-muted)" }}>
            Sunrise Apartments
          </span>
        </Link>
        <nav className="flex gap-8" aria-label="Moments">
          {MOMENTS.map((m) => {
            const on = m.key === moment.key;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => setScene({ moment: m.key })}
                className="border-b-[3px] pb-1 text-[22px]"
                style={{ borderColor: on ? "var(--t-ink)" : "transparent", color: on ? "var(--t-ink)" : "var(--t-muted)", fontWeight: on ? 600 : 400 }}
              >
                <span className="t-num mr-2" style={{ color: "var(--t-muted)" }}>
                  {m.n}
                </span>
                {m.short}
              </button>
            );
          })}
        </nav>
        <ConnectionPill size="xl" />
      </header>

      <MixedContentBanner />
      <SafeStopBanner live={live} />

      <main className="grid flex-1 grid-cols-[1.08fr_1fr] items-center gap-[3vw]">
        <div className="flex flex-col gap-3">
          <BuildingTwin b={b} panel={twinPanel(hero)} size="projector" />
          <span className="text-[16px]" style={{ color: "var(--t-muted)" }}>
            {SCALE_NOTE}
          </span>
        </div>
        <section className="flex flex-col gap-7 [@media(max-height:820px)]:gap-4">
          {moment.key === "morning" && <Morning connected={connected} offline={offline} live={live} />}
          {moment.key === "noon" && <Noon live={live} b={b} offline={offline} />}
          {moment.key === "dust" && <Dust hero={hero} />}
          {moment.key === "settle" && <Settle connected={connected} scene={scene} />}
          {moment.key === "offline" && <Offline offline={offline} b={b} />}
        </section>
      </main>

      {controls && (
        <footer className="flex flex-wrap items-center gap-3">
          {actions.map((a) => (
            <button key={a.label} type="button" className={`${a.quiet ? "btn-ghost" : "btn"} min-h-[56px] px-6 text-[20px]`} onClick={() => run(a.label, a.fn)}>
              {a.label}
            </button>
          ))}
          {note && (
            <span className="text-[20px]" style={{ color: note.bad ? "var(--t-alert)" : note.ok ? "var(--t-paid)" : "var(--t-muted)" }}>
              {note.text}
            </span>
          )}
          <span className="ml-auto text-[16px]" style={{ color: "var(--t-muted)" }}>
            1–5 moments · ← → · Space next · H hide
          </span>
        </footer>
      )}
      <ConnectionDialog />
    </div>
  );
}

function Moment({ children }) {
  return <span className="t-caps !text-[22px]">{children}</span>;
}

/** The one big number, its unit, and what it compares to. */
function Big({ value, unit, context, tone = "var(--t-ink)" }) {
  return (
    <div className="flex flex-col gap-3">
      <span className="t-num flex items-baseline gap-4 leading-none" style={{ color: tone }}>
        <span className="text-[clamp(120px,8.4vw,168px)] [@media(max-height:820px)]:text-[120px] font-medium tracking-[-0.04em]">{value}</span>
        {unit && <span className="text-[clamp(32px,2.6vw,52px)]" style={{ color: "var(--t-muted)" }}>{unit}</span>}
      </span>
      {context && <span className="t-num text-[30px]" style={{ color: "var(--t-ink-2)" }}>{context}</span>}
    </div>
  );
}

const Body = ({ children, muted }) => (
  <p className="m-0 max-w-[30ch] text-[26px] leading-snug" style={{ color: muted ? "var(--t-muted)" : "var(--t-ink)" }}>
    {children}
  </p>
);

// ---- 1 · morning plan ------------------------------------------------------
function Morning({ connected, offline, live }) {
  const api = usePlan(connected, 5000);
  const hasPlan = api?.plan && api.mode === "ai";
  if (connected && !hasPlan)
    return (
      <>
        <Moment>1 · Morning plan</Moment>
        <Big value="—" context={offline ? "No plan: 0G can't be reached" : "No 0G plan yet today"} />
        <Body muted>{offline ? "Dyna won't guess. Until 0G answers, every flat stays on grid." : "Press the button and the Pi asks 0G Compute for today's plan."}</Body>
      </>
    );
  const view = hasPlan ? planToView(api, live.runner?.jobs) : demoPlan;
  const win = hasPlan ? api.plan.solar_window : ["10:00", "15:00"];
  const jobs = view.groups.flatMap((g) => g.jobs).sort((a, b) => a.start - b.start).slice(0, 4);
  const tee = hasPlan ? Object.entries(api.tee || {}).some(([k, v]) => /verif/i.test(k) && v === true) : true;
  return (
    <>
      <Moment>1 · Morning plan</Moment>
      <Big value={view.forecastKwh} unit="kWh" context={`forecast today · solar window ${win[0]}–${win[1]}`} />
      <div className="flex flex-col">
        {jobs.map((j) => (
          <div key={j.name} className="flex items-baseline justify-between gap-6 border-t t-hair py-3 text-[26px]">
            <span>{j.name}</span>
            <span className="t-num" style={{ color: j.running ? "var(--t-paid)" : "var(--t-ink-2)" }}>
              {j.label}
            </span>
          </div>
        ))}
      </div>
      <div className="[@media(max-height:820px)]:hidden">
      <Receipt
        size="projector"
        title="Planned by Dyna on 0G"
        time={hasPlan ? null : "demo plan"}
        chips={[
          { kind: "og-req", id: hasPlan ? api.request_id : "0xdemo-request", extra: tee ? "TEE ✓" : null },
          { kind: "og-root", id: hasPlan ? api.storage_root : null },
        ]}
      />
      </div>
    </>
  );
}

// ---- 2 · noon routing --------------------------------------------------------
function Noon({ live, b, offline }) {
  const story = routingStory(live, usePlan(!live.demo));
  const solar = ["A", "B", "C"].filter((f) => !b.flats[f]?.away && b.flats[f]?.source === "solar");
  return (
    <>
      <Moment>2 · Noon routing</Moment>
      <Big value={kw(b.meters.panel?.w)} unit="kW" context={solar.length ? `solar now · flats ${solar.join(" + ")}` : "solar now · no flat on solar"} tone="var(--t-ink)" />
      <Body>{offline && !solar.length ? "No AI, no solar switching: every flat is on grid." : story.text}</Body>
      {story.reason && (
        <div className="border-l-[3px] pl-5" style={{ borderColor: "var(--t-solar)" }}>
          <span className="t-caps !text-[18px]">Dyna's reason</span>
          <Body>“{story.reason}”</Body>
        </div>
      )}
    </>
  );
}

// ---- 3 · dust ---------------------------------------------------------------
function Dust({ hero }) {
  const [tag, tone] = statusTag(hero);
  const rows = heroReceipts(hero);
  const alert = hero.stage === "dusty" || (hero.pct != null && hero.pct < hero.dustPct && hero.stage !== "paid");
  return (
    <>
      <span className="flex items-center gap-5">
        <Moment>3 · Dusty panel</Moment>
        <span className="t-tag !text-[16px]" style={{ color: tone }}>
          {tag}
        </span>
      </span>
      <Big
        value={hero.pct != null ? Math.round(hero.pct) : "–"}
        unit="%"
        tone={alert ? "var(--t-alert)" : hero.stage === "paid" ? "var(--t-paid)" : "var(--t-ink)"}
        context={hero.actualW != null && hero.expectedW != null ? `${kw(hero.actualW)} kW of ${kw(hero.expectedW)} kW expected` : "of a clean panel in this light"}
      />
      <EscrowStrip hero={hero} size="projector" />
      <Body>{statusLine(hero)}</Body>
      {rows.length > 0 && (
        <div className="flex flex-col [@media(max-height:820px)]:hidden">
          {rows.slice(-2).map((r) => (
            <Receipt key={r.title} size="projector" {...r} />
          ))}
        </div>
      )}
    </>
  );
}

// ---- 4 · settle --------------------------------------------------------------
function Settle({ connected, scene }) {
  const rows = useBills(connected, scene.settledAt);
  const total = rows.reduce((s, r) => s + r.usdc, 0);
  const units = rows.reduce((s, r) => s + r.kwh, 0);
  const TAG = { paid: ["Paid", "var(--t-paid)"], posted: ["Posted on Arc", "var(--t-ink)"], due: ["Not posted", "var(--t-muted)"] };
  return (
    <>
      <Moment>4 · Month-end settle</Moment>
      <Big value={usdc(total)} unit="USDC" context={`${inr(total)} · ${units.toFixed(1)} units (kWh) · 3 flats`} />
      <Body muted>Each flat pays for what its own meter measured. Plain arithmetic, no AI.</Body>
      <div className="flex flex-col">
        {rows.map((r) => {
          const [t, c] = TAG[r.status];
          return (
            <div key={r.flat} className="grid grid-cols-[1fr_auto_auto] items-baseline gap-6 border-t t-hair py-3">
              <span className="text-[26px]">
                Flat {r.flat}
                <span className="t-num ml-3 text-[20px]" style={{ color: "var(--t-muted)" }}>
                  {r.kwh.toFixed(1)} units · {r.solarPct}% solar
                </span>
              </span>
              <span className="t-num flex flex-col items-end text-[28px]">
                {usdc(r.usdc)} USDC
                <span className="text-[18px]" style={{ color: "var(--t-muted)" }}>
                  {inr(r.usdc)}
                </span>
              </span>
              <span className="t-tag !text-[14px]" style={{ color: c }}>
                {r.demo && r.status !== "due" ? `${t} · demo` : t}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---- 5 · 0G offline ------------------------------------------------------------
function Offline({ offline, b }) {
  const gridW = ["A", "B", "C"].filter((f) => !b.flats[f]?.away && b.flats[f]?.source !== "solar").reduce((s, f) => s + (b.meters[f]?.w || 0), 0);
  return (
    <>
      <span className="flex items-center gap-5">
        <Moment>5 · 0G offline</Moment>
        {offline && (
          <span className="t-tag !text-[16px]" style={{ color: "var(--t-alert)" }}>
            No AI
          </span>
        )}
      </span>
      {offline ? (
        <>
          <Big value={kw(gridW)} unit="kW" context="all from the grid · pump on its timer · no AI decisions" tone="var(--t-grid)" />
          <Body>Dyna can't be reached, so nothing is guessed.</Body>
          <Body muted>The building runs on safe defaults. When 0G is back, Dyna plans again and the queued proofs upload.</Body>
        </>
      ) : (
        <>
          <Big value="Online" context="0G is answering · Dyna plans the day" />
          <Body muted>Unplug the internet to see what happens: every flat drops to grid and no decision is made without a proof.</Body>
        </>
      )}
    </>
  );
}
