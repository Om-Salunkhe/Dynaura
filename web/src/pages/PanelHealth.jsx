import { useState } from "react";
import { Link } from "react-router-dom";
import HeroSteps from "../components/HeroSteps.jsx";
import Icon from "../components/Icon.jsx";
import CleaningAlert from "../components/CleaningAlert.jsx";
import { ResolveDispute } from "../components/Dispute.jsx";
import PageHeader from "../components/PageHeader.jsx";
import Proof from "../components/Proof.jsx";
import { panel } from "../data/demo.js";
import { postJSON, useLive } from "../lib/api.js";
import { useHero } from "../lib/hero.js";

const DEADLINES = [
  { min: 60, label: "1 hour" },
  { min: 360, label: "6 hours" },
  { min: 1440, label: "24 hours" },
];

const HEADLINE = {
  clean: ["PANEL IS CLEAN", "text-sun-ink", "Output is where it should be for this light."],
  dusty: ["OUTPUT LOW", "text-bad", "The meter dropped under the line, so the Pi asks 0G to look at the panel."],
  flagged: ["NEEDS APPROVAL", "text-bad", "0G looked at the panel and says it's dirty. Approve the cleaning to lock the fee on Arc."],
  disputed: ["DISPUTED", "text-bad", "The cleaner disputed the job. The committee decides: pay the cleaner or refund the society."],
  resolved: ["RESOLVED", "text-good", "The committee resolved the dispute."],
  open: ["ESCROW OPEN", "text-bad", "The fee is locked on Arc. Waiting for a cleaner to accept."],
  accepted: ["CLEANER ON THE WAY", "text-sun-ink", "A cleaner accepted. The meter decides when it's clean."],
  cleaning: ["CHECKING THE METER", "text-sun-ink", "The panel is coming back. It pays at the clean line."],
  paid: ["PAID BY THE SUN", "text-good", "Back above the clean line: USDC went to the cleaner automatically."],
  refunded: ["REFUNDED", "text-bad", "Nobody cleaned before the deadline, so the fee went back to the society."],
};

export default function PanelHealth() {
  const live = useLive();
  const hero = useHero(live);
  const pct = hero.pct != null ? Math.round(hero.pct) : null;
  const dusty = pct != null && pct < hero.dustPct;
  const [kicker, tone, text] =
    hero.stage === "dusty" && !hero.flagged
      ? ["OUTPUT LOW", "text-bad", hero.state === "rejected" ? "The committee dismissed the last cleaning request." : `Under ${hero.dustPct}%. The meter only triggers a look: 0G decides if it's dust.`]
      : HEADLINE[hero.stage] || HEADLINE.clean;
  const ring = hero.stage === "paid" ? "--good" : dusty ? "--bad" : "--sun";
  const j = hero.job;

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        kicker="Admin · Sunrise Apartments"
        title="Panel health"
        right={<span className="rounded-md bg-btn px-2 py-1 text-[11px] font-medium tracking-wider text-btn-ink">ADMIN</span>}
      />
      <CleaningAlert />

      <section className="card flex items-center gap-4 rounded-[14px]">
        <div
          className="relative grid h-28 w-28 flex-none place-items-center rounded-full transition-[background] duration-300"
          style={{ background: `conic-gradient(var(${ring}) 0 ${pct ?? 0}%, var(--idle) ${pct ?? 0}% 100%)` }}
          title={`Alert line ${hero.dustPct}% · clean line ${hero.cleanPct}%`}
        >
          {[
            [hero.dustPct, "bg-bad"],
            [hero.cleanPct, "bg-good"],
          ].map(([p, c]) => (
            <span key={p} className="absolute inset-0" style={{ transform: `rotate(${p * 3.6}deg)` }}>
              <span className={`absolute left-1/2 top-0 h-3 w-1 -translate-x-1/2 rounded-full ${c}`} />
            </span>
          ))}
          <div className="grid h-[84px] w-[84px] place-items-center rounded-full bg-card-solid text-center leading-tight">
            <span>
              <span className="block text-2xl font-medium">{pct ?? "–"}%</span>
              <span className="text-[10px] text-muted">of clean</span>
            </span>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className={`text-[11px] font-medium tracking-wider ${tone}`}>{kicker}</span>
          <span className="text-sm font-medium">{text}</span>
          <span className="text-xs text-muted">
            Alert under {hero.dustPct}% · pays at {hero.cleanPct}%{hero.live ? " · live from the meter" : " · demo"}
          </span>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="card flex flex-col gap-0.5 rounded-[14px] p-3.5">
          <span className="text-xs text-muted">Expected now</span>
          <span className="text-xl font-medium">{hero.expectedW != null ? `${hero.expectedW.toFixed(2)} W` : "–"}</span>
          <span className="text-[11px] text-muted">a clean panel in this light</span>
        </div>
        <div className="card flex flex-col gap-0.5 rounded-[14px] p-3.5">
          <span className="text-xs text-muted">Actual now</span>
          <span className={`text-xl font-medium ${dusty ? "text-bad" : ""}`}>{hero.actualW != null ? `${hero.actualW.toFixed(2)} W` : "–"}</span>
          <span className="text-[11px] text-muted">{hero.idle ? "no flat is drawing from it" : "from the panel meter"}</span>
        </div>
      </div>

      <section className="card flex flex-col gap-3 rounded-[14px]">
        <div className="flex items-center justify-between">
          <span className="text-base font-medium">{j ? `Cleaning job #${j.id}` : "Cleaning, step by step"}</span>
          {j && <span className="chip bg-inner py-1 text-xs">{j.fee.toFixed(2)} USDC</span>}
        </div>
        <HeroSteps hero={hero} />
        <ScanPanel hero={hero} />
        {!hero.live && ["clean", "paid", "refunded", "resolved"].includes(hero.stage) && (
          <button type="button" className="btn-ghost" onClick={hero.actions.dust}>
            <Icon name="panel" size={16} />
            <span className="pl-2">Try it: put tracing paper on the panel (demo)</span>
          </button>
        )}
        {hero.live && hero.error && <span className="text-xs text-bad">Pi: {hero.error}</span>}
        {hero.live && !hero.arc && <span className="text-xs text-muted">Arc escrow isn't set up on the Pi (ARC_ESCROW), so no job opens by itself.</span>}
      </section>

      <ResolveDispute hero={hero} />
      {/* an older Pi without the v3 approval flow still gets the hand-posted job */}
      {!j && hero.live && !hero.v3 && <ManualPost hero={hero} />}

      <section className="card flex items-center justify-between rounded-[14px]">
        <span className="flex flex-col">
          <span className="text-sm font-medium">Panel record on Arkiv</span>
          <span className="text-xs text-muted">{panel.record}</span>
        </span>
        <Link to="/history" className="text-sm font-medium text-link">
          History
        </Link>
      </section>
    </div>
  );
}

/** Ask the Pi to take a picture and have 0G check it now (v3). The meter drop also does this. */
function ScanPanel({ hero }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const canScan = !hero.live || hero.v3;
  const scan = async () => {
    setNote(null);
    if (!hero.live) {
      return setNote(
        ["clean", "paid", "resolved", "refunded"].includes(hero.stage)
          ? { text: "Demo: 0G sees a clean panel. Put tracing paper on to see a dirty verdict." }
          : { text: "Demo: the panel is already being handled." },
      );
    }
    setBusy(true);
    try {
      const r = await hero.actions.scan();
      if (r?.job) setNote({ text: `0G says dirty${r.job.og?.coverage_pct != null ? ` (~${Math.round(r.job.og.coverage_pct)}% covered)` : ""}: a cleaning request is waiting for approval.`, bad: true });
      else if (r?.dirty === false) setNote({ text: `0G says clean${r.og?.reason ? `: “${r.og.reason}”` : "."} Nothing flagged.`, ok: true });
      else setNote({ text: "Scanned." });
    } catch (e) {
      setNote({ text: e.status === 503 ? "0G unreachable: nothing is flagged, nothing is guessed." : e.message, bad: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-1.5">
      <button type="button" className="btn-ghost self-start" onClick={scan} disabled={busy || !canScan || ["flagged", "open", "accepted", "cleaning", "disputed"].includes(hero.stage)}>
        {busy ? "Looking at the panel…" : "Scan panel"}
      </button>
      <span className="text-[11.5px] text-muted">
        {canScan ? "Takes a picture now and asks 0G if it's dust. A meter drop does this by itself." : "This Pi has no scan endpoint yet (needs the v3 cleaning API)."}
      </span>
      {note && <span className={`text-[12.5px] ${note.bad ? "text-bad" : note.ok ? "text-good" : "text-muted"}`}>{note.text}</span>}
    </div>
  );
}

/** The fallback: the committee posts a job by hand (the Pi normally does it). */
function ManualPost({ hero }) {
  const [fee, setFee] = useState(panel.fee.toFixed(2));
  const [deadline, setDeadline] = useState(60);
  const [posted, setPosted] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const post = async () => {
    if (!hero.live) {
      hero.actions.dust();
      return setPosted("demo");
    }
    setBusy(true);
    setErr(null);
    try {
      const job = await postJSON("/api/admin/cleaning", { fee_usdc: Number(fee), deadline_min: deadline }, { admin: true });
      setPosted(job?.open_tx || "ok");
    } catch (e) {
      setErr(`${e.message}. Is Arc set up on the Pi (ARC_PRIVATE_KEY, ARC_ESCROW) and does its wallet hold USDC?`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="card rounded-[14px]">
      <summary className="cursor-pointer list-none text-sm font-medium">
        Post a cleaning job by hand
        <span className="block text-xs font-normal text-muted">Usually not needed: the Pi posts it after a minute under {hero.dustPct}%.</span>
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2.5">
          <label className="inner flex flex-col gap-1 p-3 text-xs text-muted">
            Fee (USDC)
            <input className="bg-transparent text-lg font-medium text-ink outline-none" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
          </label>
          <label className="inner flex flex-col gap-1 p-3 text-xs text-muted">
            Deadline
            <select className="bg-transparent text-lg font-medium text-ink outline-none" value={deadline} onChange={(e) => setDeadline(Number(e.target.value))}>
              {DEADLINES.map((d) => (
                <option key={d.min} value={d.min}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ul className="flex flex-col gap-1.5 text-xs text-ink-2">
          <li className="flex gap-2"><Icon name="lock" size={14} /> The fee locks in escrow on Arc</li>
          <li className="flex gap-2"><Icon name="check" size={14} /> Releases when output is back above {hero.cleanPct}%</li>
          <li className="flex gap-2"><Icon name="clock" size={14} /> Refunds to the society after the deadline</li>
        </ul>
        <button type="button" className="btn min-h-[52px] text-[15px]" disabled={!!posted || busy} onClick={post}>
          {busy ? "Locking on Arc…" : posted ? (hero.live ? "Job posted on Arc" : "Job posted (demo)") : `Lock ${Number(fee || 0).toFixed(2)} USDC and post`}
        </button>
        {posted && posted.startsWith?.("0x") && <Proof kind="arc" id={posted} label="Escrow opened" className="self-center text-xs" />}
        {err && <span className="text-center text-xs text-bad">{err}</span>}
      </div>
    </details>
  );
}
