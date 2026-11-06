// The 4 demo scenarios on one screen, live from the Pi. Built for the judges' table: a big
// building on the right that follows the real board, and on the left what to do and what to look at.
// Keys: 1-4 pick a scenario, ← → step through.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ConnectionDialog, ConnectionPill, MixedContentBanner } from "../components/Connection.jsx";
import Icon from "../components/Icon.jsx";
import Proof from "../components/Proof.jsx";
import { getJSON, postJSON, shortId, useLive } from "../lib/api.js";
import { cleaningApi, useCleaningApi } from "../lib/cleaningApi.js";

const SCENARIOS = [
  { key: "sun", n: 1, title: "Sun in, flats switch to solar", short: "Sun → solar" },
  { key: "pump", n: 2, title: "Flats away, 0G runs the pump", short: "Spare → pump" },
  { key: "sell", n: 3, title: "Nobody needs it, sell it P2P", short: "Sell P2P" },
  { key: "clean", n: 4, title: "Dusty panel, cleaner paid on Arc", short: "Dust → paid" },
];

const FLATS = ["A", "B", "C"];
// the model panel under a desk lamp gives milliwatts, so small readings keep 3 decimals
const W = (x) => (x == null ? "–" : `${Number(x).toFixed(Number(x) < 0.1 ? 3 : Number(x) < 1 ? 2 : 1)} W`);
// Sun the panel can give right now. The Pi's figure first: on the real board the panel meter reads it
// through its own load, while the SIM panel meter only shows what flats draw from it.
const sunW = (live) => live.spare_pump?.now?.panel_w ?? live.meters?.panel?.w;

// Poll one Pi path while `on` (no polling without a Pi).
function usePoll(path, on, every = 3000) {
  const [data, setData] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!on || !path) return undefined;
    let alive = true;
    const go = () => getJSON(path).then((d) => alive && setData(d)).catch(() => {});
    go();
    const t = setInterval(go, every);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [path, on, every, tick]);
  return [data, () => setTick((t) => t + 1)];
}

export default function Scenarios() {
  const live = useLive();
  const connected = !live.demo;
  const [idx, setIdx] = useState(() => {
    const n = Number(new URLSearchParams(window.location.search).get("s"));
    return n >= 1 && n <= SCENARIOS.length ? n - 1 : 0;
  });
  const [note, setNote] = useState(null);
  const sc = SCENARIOS[idx];

  const run = useCallback(async (label, fn) => {
    setNote({ text: `${label}…` });
    try {
      const r = await fn();
      const skipped = r && typeof r === "object" && r.skipped;
      setNote({ text: skipped ? `${label}: ${r.skipped}` : `${label}: done`, ok: !skipped, bad: !!skipped });
    } catch (e) {
      setNote({ text: `${label}: ${e.message}`, bad: true });
    }
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.("input, textarea, select")) return;
      const n = Number(e.key);
      if (n >= 1 && n <= SCENARIOS.length) setIdx(n - 1);
      else if (e.key === "ArrowRight") setIdx((i) => Math.min(i + 1, SCENARIOS.length - 1));
      else if (e.key === "ArrowLeft") setIdx((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => setNote(null), [idx]);

  const body = { sun: SunScenario, pump: PumpScenario, sell: SellScenario, clean: CleanScenario }[sc.key];
  const Body = body;

  return (
    <div className="flex min-h-screen flex-col gap-4 px-4 py-4 md:px-[3vw] md:py-[2vw]">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <Link to="/admin" className="flex items-center gap-3" title="Back to the app">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#111418] text-sun">
            <Icon name="sun" size={26} />
          </span>
          <span className="flex flex-col">
            <span className="text-2xl font-medium tracking-[-0.5px]">Dynaura scenarios</span>
            <span className="text-sm text-muted">0G decides, Arc pays, Arkiv remembers</span>
          </span>
        </Link>
        <nav className="flex flex-wrap gap-1.5 rounded-full border border-line bg-card p-1.5" aria-label="Scenarios">
          {SCENARIOS.map((s, i) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setIdx(i)}
              className={`flex items-center gap-2 rounded-full px-4 py-2.5 text-base font-medium ${i === idx ? "bg-btn text-btn-ink" : "text-muted hover:text-ink"}`}
            >
              <span className="opacity-60">{s.n}</span>
              <span>{s.short}</span>
            </button>
          ))}
        </nav>
        <ConnectionPill size="lg" />
      </header>

      <MixedContentBanner />
      {!connected && (
        <div className="card border-bad/40 p-4 text-base">
          <b>Not connected to the Pi.</b> Tap the pill at the top right and set the Pi's address (for example
          http://192.168.x.x:8000). The scenarios run on the real board.
        </div>
      )}
      {connected && live.safe_stop?.active && (
        <div className="card p-4 text-base">
          <b>Safe stop:</b> {live.safe_stop.reason}. Every flat is on grid and the pump is off.
        </div>
      )}

      <main className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Body live={live} connected={connected} run={run} title={sc.title} n={sc.n} />
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
        <span>Keys 1–4 pick a scenario, ← → step through.</span>
        {note && <span className={`text-base ${note.bad ? "text-bad" : note.ok ? "text-good" : "text-ink"}`}>{note.text}</span>}
      </footer>
      <ConnectionDialog />
    </div>
  );
}

// ---- shared pieces --------------------------------------------------------------------------

function Story({ n, title, story, steps, children }) {
  return (
    <section className="card flex flex-col gap-4 p-5">
      <div>
        <div className="label">Scenario {n}</div>
        <h1 className="text-[clamp(26px,3vw,44px)] font-medium leading-tight tracking-[-1px]">{title}</h1>
        <p className="mt-2 text-lg text-ink-2">{story}</p>
      </div>
      <ol className="flex flex-col gap-2">
        {steps.map((s, i) => (
          <li key={s.text} className="flex items-start gap-3 text-base">
            <span
              className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-medium ${
                s.done ? "bg-good text-white" : "bg-inner text-muted"
              }`}
            >
              {s.done ? <Icon name="check" size={16} /> : i + 1}
            </span>
            <span className={s.done ? "text-ink" : "text-ink-2"}>
              {s.text}
              {s.hint && <span className="block text-sm text-muted">{s.hint}</span>}
            </span>
          </li>
        ))}
      </ol>
      {children}
    </section>
  );
}

function Actions({ items, run, connected }) {
  const list = items.filter(Boolean);
  if (!list.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {list.map((a) => (
        <button
          key={a.label}
          type="button"
          disabled={!connected || a.disabled}
          className={`${a.quiet ? "btn-ghost" : "btn"} min-h-[48px] px-5 text-base disabled:opacity-40`}
          onClick={() => run(a.label, a.fn)}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

const admin = (path, body) => () => postJSON(path, body || {}, { admin: true });

/** The model building: panel on the roof, 3 flats, the tank pump. Follows the live state. */
function Building({ live, highlight = [], extra }) {
  const panelW = sunW(live);
  const sunOk = live.runner?.sun_ok;
  const pumpOn = live.pump?.on;
  return (
    <section className="card flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <div className="label">The building, live</div>
        <span className="text-sm text-muted">runner: {live.runner?.mode || "–"}</span>
      </div>
      <div className={`flex items-center justify-between rounded-2xl p-4 ${sunOk ? "bg-sun-soft" : "bg-inner"}`}>
        <span className="flex items-center gap-3 text-lg">
          <Icon name="panel" size={28} className={sunOk ? "text-sun-ink" : "text-muted"} />
          Rooftop panel
        </span>
        {/* the panel's voltage rises with the lamp; the watts are what the Pi counts as sun */}
        <span className="flex flex-col items-end">
          <span className="num text-3xl font-medium">{live.meters?.panel?.v != null ? `${Number(live.meters.panel.v).toFixed(2)} V` : "–"}</span>
          <span className="num text-sm text-muted">{W(panelW)} of sun</span>
        </span>
      </div>
      <div className="grid gap-2">
        {[...FLATS].reverse().map((f) => {
          const fl = live.flats?.[f] || {};
          const solar = fl.source === "solar";
          const away = fl.away;
          return (
            <div
              key={f}
              className={`flex items-center justify-between rounded-2xl border-2 p-4 ${
                highlight.includes(f) ? "border-ink" : "border-transparent"
              } ${away ? "bg-inner opacity-70" : solar ? "bg-sun-soft" : "bg-[#dbe8ff] dark:bg-[#1c2a44]"}`}
            >
              <span className="flex items-center gap-3 text-lg font-medium">
                <span
                  className={`h-4 w-4 rounded-full ${solar ? "bg-sun shadow-[0_0_12px_var(--sun)]" : "bg-[#3b82f6]"}`}
                  aria-hidden
                />
                Flat {f}
                {away && <span className="chip text-sm">away</span>}
              </span>
              <span className="flex items-center gap-4">
                <span className={`text-base font-medium ${solar ? "text-sun-ink" : "text-link"}`}>{solar ? "SOLAR" : "GRID"}</span>
                <span className="num w-20 text-right text-base text-muted">{W(live.meters?.[f]?.w)}</span>
              </span>
            </div>
          );
        })}
      </div>
      <div className={`flex items-center justify-between rounded-2xl p-4 ${pumpOn ? "bg-good/15" : "bg-inner"}`}>
        <span className="flex items-center gap-3 text-lg">
          <Icon name="water" size={26} className={pumpOn ? "text-good" : "text-muted"} />
          Tank pump
        </span>
        <span className={`text-xl font-medium ${pumpOn ? "text-good" : "text-muted"}`}>{pumpOn ? "PUMPING" : "off"}</span>
      </div>
      {extra}
    </section>
  );
}

function ZgChip({ id, label = "0G request" }) {
  if (!id) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-inner px-2.5 py-1 text-sun-ink" title={id}>
      <span className="font-medium">{label}</span>
      <span className="mono opacity-80">{shortId(id)}</span>
    </span>
  );
}

function Decision({ title, d }) {
  if (!d) return null;
  return (
    <div className="rounded-2xl bg-inner p-4">
      <div className="label">{title}</div>
      <p className="mt-1 text-lg">{d.text}</p>
      <div className="mt-2 flex flex-wrap gap-2 text-sm">
        {d.mode === "no-ai" ? <span className="chip text-bad">0G offline: nothing faked</span> : <ZgChip id={d.request_id} />}
        {d.root && <Proof kind="og" id={d.root} />}
        {d.when && <span className="text-muted">{d.when}</span>}
      </div>
    </div>
  );
}

const ago = (ts) => {
  if (!ts) return null;
  const s = Math.max(0, Math.round(Date.now() / 1000 - ts));
  return s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
};

// ---- 1. sun in, flats to solar ----------------------------------------------------------------

function SunScenario({ live, connected, run, title, n }) {
  const [plan] = usePoll("/api/plan", connected, 5000);
  const hasPlan = live.runner?.mode === "plan";
  const sunOk = !!live.runner?.sun_ok;
  const onSolar = FLATS.filter((f) => live.flats?.[f]?.source === "solar" && !live.flats?.[f]?.away);
  const home = FLATS.filter((f) => !live.flats?.[f]?.away);
  return (
    <>
      <Story
        n={n}
        title={title}
        story="Every flat starts on grid power. When the sun reaches the panel, the Pi moves each flat to solar by itself, inside the window that Dyna planned on 0G."
        steps={[
          { text: "Dyna's plan for today is ready on 0G", done: hasPlan, hint: hasPlan ? null : "Press “Ask 0G for today's plan” below" },
          { text: "All flats start on grid (blue)", done: hasPlan && onSolar.length === 0 && !sunOk },
          { text: "Point the lamp at the panel", done: sunOk, hint: "The panel must give the minimum power to switch" },
          { text: `Flats switch to solar (yellow) by themselves: ${onSolar.length}/${home.length}`, done: home.length > 0 && onSolar.length === home.length },
          { text: "Turn the lamp away: flats go back to grid", hint: "Nobody pressed a button: the meter and the plan decide" },
        ]}
      >
        <Actions
          connected={connected}
          run={run}
          items={[
            { label: "Ask 0G for today's plan", fn: admin("/api/plan/run?which=today"), quiet: hasPlan },
            { label: "Everyone home", fn: async () => Promise.all(FLATS.map((f) => postJSON(`/api/moment/home-${f}`, {}, { admin: true }))), quiet: true },
          ]}
        />
        {plan?.plan && (
          <Decision
            title="Dyna's plan (0G)"
            d={{
              text: `Solar window ${plan.plan.solar_window?.join("–")}. ${plan.plan.summary || ""}`,
              request_id: plan.request_id,
              root: plan.storage_root,
              mode: plan.mode,
              when: ago(plan.ts),
            }}
          />
        )}
      </Story>
      <Building live={live} />
    </>
  );
}

// ---- 2. flats away, 0G runs the pump on spare sun --------------------------------------------

function PumpScenario({ live, connected, run, title, n }) {
  const sp = live.spare_pump || {};
  const last = sp.last;
  const away = FLATS.filter((f) => live.flats?.[f]?.away);
  // the Pi's own figure (it knows the sun the panel can give); else panel meter minus the home flats
  const panelW = sunW(live) || 0;
  const homeW = FLATS.filter((f) => !away.includes(f)).reduce((s, f) => s + (live.meters?.[f]?.w || 0), 0);
  const spareW = sp.now?.spare_w ?? Math.max(0, panelW - homeW);
  const bcAway = away.includes("B") && away.includes("C");
  const setAway = (flats, isAway) => async () =>
    Promise.all(FLATS.map((f) => postJSON(`/api/moment/${flats.includes(f) === isAway ? "away" : "home"}-${f}`, {}, { admin: true })));
  return (
    <>
      <Story
        n={n}
        title={title}
        story="At noon flats B and C are away, so their share of the sun would be wasted. Dyna on 0G sees the spare power and decides to run the shared tank pump on it now, live."
        steps={[
          { text: "Flats B and C go away", done: bcAway },
          { text: `Spare sun on the roof: ${W(spareW)}`, done: spareW >= (sp.min_spare_w ?? 0.3), hint: `Needs at least ${W(sp.min_spare_w ?? 0.3)}: keep the lamp on the panel` },
          { text: "Dyna asks 0G: run the pump now?", done: !!last && last.mode === "ai", hint: sp.deciding ? "0G is deciding…" : "It asks by itself, or press “Ask 0G now”" },
          { text: "The pump runs on the sun", done: !!live.pump?.on || !!last?.run_pump },
        ]}
      >
        <Actions
          connected={connected}
          run={run}
          items={[
            { label: "Flats B & C away", fn: setAway(["B", "C"], true), disabled: bcAway },
            { label: "Ask 0G now", fn: admin("/api/admin/spare/check"), disabled: sp.deciding },
            { label: "Everyone home", fn: setAway([], true), quiet: true },
          ]}
        />
        {last && (
          <Decision
            title="0G's decision"
            d={{
              text: last.mode === "no-ai" ? last.reason : last.run_pump ? `Run the pump for ${last.seconds} s. ${last.reason || ""}` : `Pump stays off. ${last.reason || ""}`,
              request_id: last.request_id,
              mode: last.mode,
              when: ago(last.at),
            }}
          />
        )}
        {last?.notes?.length > 0 && <p className="text-sm text-muted">{last.notes.join(" · ")}</p>}
      </Story>
      <Building live={live} highlight={["B", "C"]} />
    </>
  );
}

// ---- 3. nobody needs it: sell P2P --------------------------------------------------------------

const ROUTE_NAME = (to) => (to === "shop" ? "Nearby shop" : to === "grid" ? "Grid (feed-in)" : /^[ABC]$/.test(to) ? `Flat ${to}` : String(to));

function SellScenario({ live, connected, run, title, n }) {
  const [market, reloadMarket] = usePoll("/api/marketplace", connected, 4000);
  const [trades, reloadTrades] = usePoll("/api/decisions?kind=trade&limit=1", connected, 4000);
  const t = market?.trader?.last || (trades?.[0] ? { ...trades[0].output, request_id: trades[0].request_id, mode: trades[0].mode, at: trades[0].ts } : null);
  const routes = t?.routes || [];
  const panelW = sunW(live) || 0;
  // what the flats draw from the sun right now (flats on grid don't use the panel's share)
  const usedW = FLATS.filter((f) => live.flats?.[f]?.source === "solar").reduce((s, f) => s + (live.meters?.[f]?.w || 0), 0);
  const offer = market?.offer;
  const orders = market?.orders || [];
  const sales = market?.sales || [];
  const sellNow = async () => {
    const r = await postJSON("/api/admin/credits/trade", { minutes: 5, include_now: true }, { admin: true });
    reloadMarket();
    reloadTrades();
    return r;
  };
  return (
    <>
      <Story
        n={n}
        title={title}
        story="The sun is shining, no shared job is waiting and the flats aren't using their share. Instead of wasting it, Dyna on 0G sells the spare: first to a neighbour who needs more, then to a nearby shop, and the rest to the grid. Shops prepay in USDC on Arc."
        steps={[
          { text: `Spare sun: panel gives ${W(panelW)}, flats on solar use ${W(usedW)}`, done: panelW - usedW > 0.05, hint: "Keep the lamp on for about 30 seconds: “Sell” counts the last 5 minutes and the one in progress" },
          { text: "Dyna on 0G decides who buys the spare", done: !!t && t.mode === "ai", hint: "Press “Sell the spare now” (it also runs by itself every few minutes)" },
          { text: "A nearby shop sees the offer and prepays on Arc", done: orders.some((o) => o.status === "open" || o.status === "settled"), hint: "Pawan's phone: Shop → Offers" },
          { text: "After the window the Pi settles what was delivered", done: sales.length > 0 },
        ]}
      >
        <Actions connected={connected} run={run} items={[{ label: "Sell the spare now (0G)", fn: sellNow }]} />
        {t && (
          <div className="rounded-2xl bg-inner p-4">
            <div className="label">0G's trade</div>
            {routes.length ? (
              <ul className="mt-2 flex flex-col gap-1.5">
                {routes.map((r, i) => (
                  <li key={i} className="flex items-center justify-between text-lg">
                    <span>{ROUTE_NAME(r.to)}</span>
                    <span className="num text-ink-2">
                      {Number(r.wh).toFixed(3)} Wh{r.price != null && ` @ ${r.price} USDC/kWh`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-lg">{t.skipped || t.reason || "No spare to route yet"}</p>
            )}
            {t.reason && routes.length > 0 && <p className="mt-2 text-base text-ink-2">{t.reason}</p>}
            <div className="mt-2 flex flex-wrap gap-2 text-sm">
              {t.mode === "no-ai" ? <span className="chip text-bad">0G offline: fixed rule, nothing sold to shops</span> : <ZgChip id={t.request_id} />}
              {t.at && <span className="text-muted">{ago(t.at)}</span>}
            </div>
          </div>
        )}
      </Story>
      <Building
        live={live}
        extra={
          <div className="rounded-2xl bg-inner p-4">
            <div className="label">Marketplace</div>
            {offer ? (
              <p className="mt-1 text-lg">
                Offer to shops: <b>{offer.kwh} kWh</b> at {offer.price_usdc} USDC/kWh
              </p>
            ) : (
              <p className="mt-1 text-base text-muted">No open offer right now.</p>
            )}
            {orders.slice(0, 3).map((o) => (
              <div key={o.order_id} className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <span>
                  Order #{o.order_id}: {o.status}
                  {o.kwh != null && `, ${o.kwh} kWh`}
                </span>
                {o.tx && <Proof kind="arc" id={o.tx} />}
                {o.settle_tx && <Proof kind="arc" id={o.settle_tx} label="Settled" />}
              </div>
            ))}
          </div>
        }
      />
    </>
  );
}

// ---- 4. dusty panel, cleaner paid on Arc --------------------------------------------------------

const CLEAN_FLOW = [
  { key: "flagged", text: "0G looks at the panel and flags it dirty" },
  { key: "open", text: "The committee approves: the fee is locked in the Arc escrow" },
  { key: "accepted", text: "The cleaner accepts the job from their wallet" },
  { key: "cleaned", text: "Cleaner taps “Mark done”, the meter checks the panel" },
  { key: "paid", text: "Panel back to its old output: USDC released to the cleaner" },
];
const ORDER = { flagged: 0, approved: 1, open: 1, accepted: 2, cleaned: 3, paid: 4, resolved: 4 };

function CleanScenario({ live, connected, run, title, n }) {
  const api = useCleaningApi(connected);
  const data = api.data || live.cleaning || {};
  const job = api.job || data.job || null;
  const state = job?.state || job?.status || null;
  const at = state ? ORDER[state] ?? -1 : -1;
  const pct = data.pct;
  const terminal = !job || ["paid", "rejected", "refunded", "resolved", "no_check"].includes(state);
  return (
    <>
      <Story
        n={n}
        title={title}
        story="Dust quietly steals a panel's output. Dynaura spots it, 0G confirms it, and the cleaner is paid in USDC only when the meter proves the panel makes as much as before. Nobody has to trust anybody's word."
        steps={[
          { text: "Put tracing paper on the panel (the dust)", done: (pct != null && pct < (data.dust_pct ?? 70)) || at >= 0, hint: pct != null ? `Panel at ${Math.round(pct)}% of clean (alert under ${data.dust_pct ?? 70}%)` : null },
          ...CLEAN_FLOW.map((s, i) => ({ text: s.text, done: at >= i })),
        ]}
      >
        <Actions
          connected={connected}
          run={run}
          items={[
            terminal && { label: "Scan panel (0G)", fn: cleaningApi.scan },
            state === "flagged" && { label: "Committee approves", fn: () => cleaningApi.approve() },
            state === "flagged" && { label: "Reject", fn: cleaningApi.reject, quiet: true },
            (state === "accepted" || state === "open") && { label: "Cleaner: Mark done", fn: cleaningApi.done, disabled: state !== "accepted" },
          ]}
        />
        {state === "open" && <p className="text-base text-muted">Now the cleaner accepts on their phone: Cleaner → Jobs → Accept (their own wallet).</p>}
        {state === "cleaned" && <p className="text-base text-muted">Take the paper off. The Pi pays when the panel is back to {data.clean_pct ?? 90}% or more.</p>}
        {job && (
          <div className="rounded-2xl bg-inner p-4">
            <div className="label">Cleaning job · {state}</div>
            <p className="mt-1 text-lg">
              Dusty at {job.dusty_pct != null ? `${Math.round(job.dusty_pct)}%` : "–"}
              {job.after_pct != null && `, after cleaning ${Math.round(job.after_pct)}%`}
              {job.fee_usdc ? ` · fee ${job.fee_usdc} USDC` : ""}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-sm">
              <ZgChip id={job.og?.request_id} label="0G dust check" />
              {job.arc?.open_tx && <Proof kind="arc" id={job.arc.open_tx} label="Escrow opened" />}
              {job.arc?.release_tx && <Proof kind="arc" id={job.arc.release_tx} label="Cleaner paid" />}
              {job.arc?.refund_tx && <Proof kind="arc" id={job.arc.refund_tx} label="Refunded" />}
            </div>
          </div>
        )}
      </Story>
      <Building
        live={live}
        extra={
          <div className="rounded-2xl bg-inner p-4">
            <div className="label">Panel health</div>
            <div className="mt-2 h-4 overflow-hidden rounded-full bg-line">
              <div
                className={`h-full rounded-full ${pct != null && pct < (data.dust_pct ?? 70) ? "bg-bad" : "bg-good"}`}
                style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%` }}
              />
            </div>
            <p className="mt-1 text-base text-muted">
              {pct != null ? `${Math.round(pct)}% of a clean panel in the same light` : "Waiting for the panel reading"}
            </p>
          </div>
        }
      />
    </>
  );
}
