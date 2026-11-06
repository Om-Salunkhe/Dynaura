import { useState } from "react";
import Icon from "../components/Icon.jsx";
import PageHeader from "../components/PageHeader.jsx";
import Proof from "../components/Proof.jsx";
import WalletButton from "../components/WalletButton.jsx";
import { cleaner } from "../data/demo.js";
import { useLive } from "../lib/api.js";
import { ARC_READY, errText, short, useWallet, write } from "../lib/arc.js";
import { fetchCleaningJobs, useArkiv } from "../lib/arkiv.js";
import { stageIndex, useHero } from "../lib/hero.js";

const STEPS = [
  ["Accept the job", "From your own wallet, on Arc"],
  ["Clean the panel, tap Mark done", "The meter checks the panel, not your word"],
  ["Back at 90%+ for a minute", "USDC is yours. Nobody presses approve."],
];

const ends = (ms) => new Date(ms).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

export default function CleanerJobs() {
  const live = useLive();
  const hero = useHero(live);
  const w = useWallet();
  const onChain = hero.live && hero.arc && ARC_READY.escrow;
  const i = stageIndex(hero.stage);
  const step = i <= 2 ? 0 : i <= 4 ? 1 : 2;
  const paidNow = hero.stage === "paid" ? hero.job?.fee || 0 : 0;
  // The public job board on Arkiv: every escrow the building opened, with its status
  const board = useArkiv(() => fetchCleaningJobs({ limit: 10 }), null, [hero.stage]);
  const arkJobs = board.live && board.data.length ? board.data : null;

  return (
    <div className="flex flex-col gap-3">
      <PageHeader kicker={`Hi, ${cleaner.name}`} title="Clean panels. Get paid by the sun." />
      {onChain && <WalletButton />}

      {!hero.live && (
        <div className="grid grid-cols-2 gap-2.5">
          <div className="card flex flex-col gap-0.5 rounded-[20px] p-3.5">
            <span className="text-xs text-muted">Earned this month</span>
            <span className="text-xl font-extrabold">{(cleaner.earned + paidNow).toFixed(2)} USDC</span>
          </div>
          <div className="card flex flex-col gap-0.5 rounded-[20px] p-3.5">
            <span className="text-xs text-muted">Jobs done</span>
            <span className="text-xl font-extrabold">{cleaner.done + (paidNow ? 1 : 0)}</span>
          </div>
        </div>
      )}

      <JobCard hero={hero} onChain={onChain} me={w.address} />

      <section className="card flex flex-col gap-2.5 rounded-[26px]">
        <span className="text-base font-bold">How you get paid</span>
        {STEPS.map(([t, sub], n) => {
          const done = i >= 2 && (n < step || hero.stage === "paid");
          const now = i >= 2 && n === step && hero.stage !== "paid";
          return (
            <div key={t} className={`flex items-center gap-3 text-sm ${!done && !now && i >= 2 ? "opacity-50" : ""}`}>
              <span
                className={`grid h-8 w-8 flex-none place-items-center rounded-full text-xs font-extrabold ${
                  done ? "bg-good text-white" : now ? "animate-pulse bg-sun text-[#111418]" : "bg-btn text-btn-ink"
                }`}
              >
                {done ? <Icon name="check" size={14} /> : n + 1}
              </span>
              <span className="flex flex-col">
                <span className="font-bold">{t}</span>
                <span className="text-xs text-muted">{sub}</span>
              </span>
            </div>
          );
        })}
      </section>

      {arkJobs && (
        <section className="card flex flex-col gap-1 rounded-[26px]">
          <span className="text-base font-bold">Job board on Arkiv</span>
          <span className="pb-1 text-xs text-muted">Every cleaning escrow the building opened. Anyone can check it.</span>
          {arkJobs.map((j) => (
            <div key={j.key} className="flex flex-col gap-1.5 border-t border-line py-2.5 text-sm first-of-type:border-0">
              <div className="flex items-center justify-between">
                <span className="font-bold">Job #{j.jobId}</span>
                <span className={`chip py-0.5 text-[11px] ${j.status === "paid" ? "bg-[rgba(47,158,106,0.16)] text-good" : j.status === "refunded" ? "bg-[rgba(180,35,24,0.12)] text-bad" : "bg-sun-soft text-sun-ink"}`}>
                  {j.status} · {j.feeUsdc.toFixed(2)} USDC
                </span>
              </div>
              <span className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="text-muted">
                  {Math.round(j.outputBefore)}%{j.outputAfter != null ? ` → ${Math.round(j.outputAfter)}%` : ""} output
                </span>
                <Proof kind="arc" id={j.arcTx} />
                <Proof kind="arkiv" id={j.key} />
              </span>
            </div>
          ))}
        </section>
      )}

      {!hero.live && !arkJobs && (
        <section className="card flex flex-col gap-1 rounded-[26px]">
          <span className="pb-1 text-base font-bold">Paid jobs</span>
          {cleaner.paid.map((p) => (
            <div key={p.id} className="flex items-center justify-between py-1.5 text-sm">
              <span className="flex flex-col">
                <span className="font-bold">
                  Job #{p.id} · {p.when}
                </span>
                <span className="text-xs text-muted">{p.text}</span>
              </span>
              <span className="text-xs font-bold text-muted">{p.amount.toFixed(2)} USDC</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function JobCard({ hero, onChain, me }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [acceptTx, setAcceptTx] = useState(null);
  const j = hero.job;
  const pct = hero.pct != null ? Math.round(hero.pct) : null;

  if (["clean", "dusty"].includes(hero.stage) || !j) {
    return (
      <section className="card flex flex-col gap-2 rounded-[26px] text-sm">
        <span className="text-[11px] font-extrabold tracking-wider text-muted">{hero.stage === "dusty" ? "A JOB IS OPENING" : "NO JOBS RIGHT NOW"}</span>
        <span className="text-base font-bold">
          {hero.stage === "dusty" ? "A panel near you just got dusty. The escrow is being locked on Arc." : "All panels near you are clean."}
        </span>
        <span className="text-muted">A job appears here when a panel drops under {hero.dustPct}% of its clean output.</span>
        {hero.live && !hero.arc && <span className="text-xs text-muted">The Pi has no Arc escrow set up, so it can't post jobs yet.</span>}
        {!hero.live && hero.stage === "clean" && (
          <button type="button" className="btn-ghost mt-1" onClick={hero.actions.dust}>
            Show me a job (demo)
          </button>
        )}
      </section>
    );
  }

  // no wallet connected (the demo laptop): treat the job as yours
  const mine = !onChain || !me || !j.cleaner || j.cleaner.toLowerCase() === me.toLowerCase();
  // live Pi but no escrow address in this app: the job is real, but this screen can't sign for it
  const canAccept = onChain || !hero.live;
  const accept = async () => {
    if (!onChain) return hero.actions.accept?.();
    setBusy(true);
    setErr(null);
    try {
      setAcceptTx(await write("escrow", "accept", [BigInt(j.id)]));
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  if (hero.stage === "paid" || hero.stage === "refunded") {
    const paid = hero.stage === "paid";
    return (
      <section className={`card flex flex-col gap-3 rounded-[26px] ${paid ? "border-2 border-good" : ""}`}>
        <span className={`text-[11px] font-extrabold tracking-wider ${paid ? "text-good" : "text-bad"}`}>
          {paid ? "PAID BY THE SUN" : "REFUNDED TO THE SOCIETY"} · JOB #{j.id}
        </span>
        <span className="text-4xl font-extrabold">{paid ? `+${j.fee.toFixed(2)} USDC` : `${j.fee.toFixed(2)} USDC`}</span>
        <span className="text-sm text-muted">
          {paid
            ? `The panel went from ${Math.round(j.outputBefore)}% to ${Math.round(j.outputAfter ?? pct)}%. The Pi released the escrow by itself.`
            : "Nobody cleaned before the deadline."}
        </span>
        <span className="flex flex-wrap gap-2 text-xs">
          <Proof kind="arc" id={j.releaseTx || j.refundTx} label={paid ? "Released on Arc" : "Refund on Arc"} />
          <Proof kind="og" id={hero.og?.paid} label="0G proof" />
          {paid && j.proof && <Proof kind="hash" id={j.proof} label="Meter proof" />}
        </span>
      </section>
    );
  }

  return (
    <section className="card flex flex-col gap-3 rounded-[26px]">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-extrabold tracking-wider text-sun-ink">
          {hero.stage === "open" ? "NEW JOB NEAR YOU" : mine ? "YOUR JOB" : "TAKEN"} · #{j.id}
        </span>
        <span className="text-xs text-muted">Ends {ends(j.deadline)}</span>
      </div>
      <span className="flex flex-col gap-0.5">
        <span className="text-lg font-extrabold">Sunrise Apartments</span>
        <span className="text-sm text-muted">Andheri East · 1 roof panel · was at {Math.round(j.outputBefore)}% output</span>
      </span>
      <div className="inner flex items-center justify-between p-3">
        <span className="flex items-center gap-2 text-sm">
          <Icon name="lock" size={16} /> Locked in escrow on Arc
        </span>
        <span className="text-lg font-extrabold">{j.fee.toFixed(2)} USDC</span>
      </div>
      {j.openTx && <Proof kind="arc" id={j.openTx} label="Escrow on Arc" className="self-start text-xs" />}

      {hero.stage === "open" && (
        <>
          <button type="button" className="btn min-h-[56px] text-base" disabled={busy || !canAccept} onClick={accept}>
            {busy ? "Confirm in your wallet…" : "Accept job"}
          </button>
          {!canAccept && <span className="text-center text-xs text-muted">This app has no escrow contract address set (VITE_ARC_ESCROW), so it can't accept on Arc.</span>}
        </>
      )}

      {hero.stage === "accepted" && mine && (
        <>
          <span className="text-sm text-ink-2">Clean the panel, then tap Mark done. Your tap doesn't release the money: the meter has to see it.</span>
          <button type="button" className="btn min-h-[56px] text-base" onClick={hero.actions.done}>
            Mark done · let the meter check
          </button>
        </>
      )}

      {(hero.stage === "cleaning" || (hero.stage === "accepted" && !mine)) && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-bold">{mine ? "The meter is checking your work" : `Another cleaner (${short(j.cleaner)}) took this job`}</span>
            <span className={`text-3xl font-extrabold ${pct != null && pct >= hero.cleanPct ? "text-good" : ""}`}>{pct ?? "–"}%</span>
          </div>
          <div className="relative h-4 overflow-hidden rounded-full bg-inner">
            <span className="absolute inset-y-0 left-0 rounded-full bg-sun transition-[width] duration-300" style={{ width: `${Math.min(pct ?? 0, 100)}%` }} />
            <span className="absolute inset-y-0 w-1 bg-good" style={{ left: `${hero.cleanPct}%` }} title={`Pays at ${hero.cleanPct}%`} />
          </div>
          <span className="text-xs text-muted">
            The contract pays on meter proof, not on your word: {j.fee.toFixed(2)} USDC is released automatically once the panel holds {hero.cleanPct}%+ for a minute.
          </span>
        </div>
      )}

      {acceptTx && <Proof kind="arc" id={acceptTx} label="Accepted on Arc" className="self-center text-xs" />}
      {err && <span className="text-center text-xs text-bad">{err}</span>}
    </section>
  );
}
