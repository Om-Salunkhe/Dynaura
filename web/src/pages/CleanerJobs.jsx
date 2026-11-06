import { useState } from "react";
import Icon from "../components/Icon.jsx";
import PageHeader from "../components/PageHeader.jsx";
import Proof from "../components/Proof.jsx";
import WalletButton from "../components/WalletButton.jsx";
import { DisputeButton } from "../components/Dispute.jsx";
import VerifyPayout from "../components/VerifyPayout.jsx";
import { cleaner } from "../data/demo.js";
import { useLive } from "../lib/api.js";
import { ARC_READY, errText, short, useWallet, write } from "../lib/arc.js";
import { fetchCleaningJobs, fetchWorkReceipts, useArkiv } from "../lib/arkiv.js";
import { usePiDevice, verifyPayout } from "../lib/verify.js";
import { stageIndex, useHero } from "../lib/hero.js";

const STEPS = [
  ["Accept the job", "From your own wallet, on Arc"],
  ["Clean the panel, tap Mark done", "The meter checks the panel, not your word"],
  ["Back at 90%+ for a minute", "And 15 points above the dusty level. Then USDC is yours."],
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
  const arkJobs = (board.live || board.limited) && board.data?.length ? board.data : null;

  return (
    <div className="flex flex-col gap-3">
      <PageHeader kicker={`Hi, ${cleaner.name}`} title="Clean panels. Get paid by the sun." />
      {onChain && <WalletButton />}

      {!hero.live && (
        <div className="grid grid-cols-2 gap-2.5">
          <div className="card flex flex-col gap-0.5 rounded-[14px] p-3.5">
            <span className="text-xs text-muted">Earned this month</span>
            <span className="text-xl font-medium">{(cleaner.earned + paidNow).toFixed(2)} USDC</span>
          </div>
          <div className="card flex flex-col gap-0.5 rounded-[14px] p-3.5">
            <span className="text-xs text-muted">Jobs done</span>
            <span className="text-xl font-medium">{cleaner.done + (paidNow ? 1 : 0)}</span>
          </div>
        </div>
      )}

      <JobCard hero={hero} onChain={onChain} me={w.address} />

      <section className="card flex flex-col gap-2.5 rounded-[14px]">
        <span className="text-base font-medium">How you get paid</span>
        {STEPS.map(([t, sub], n) => {
          const done = i >= 2 && (n < step || hero.stage === "paid");
          const now = i >= 2 && n === step && hero.stage !== "paid";
          return (
            <div key={t} className={`flex items-center gap-3 text-sm ${!done && !now && i >= 2 ? "opacity-50" : ""}`}>
              <span
                className={`grid h-8 w-8 flex-none place-items-center rounded-full text-xs font-medium ${
                  done ? "bg-good text-white" : now ? "animate-pulse bg-sun text-[#111418]" : "bg-btn text-btn-ink"
                }`}
              >
                {done ? <Icon name="check" size={14} /> : n + 1}
              </span>
              <span className="flex flex-col">
                <span className="font-medium">{t}</span>
                <span className="text-xs text-muted">{sub}</span>
              </span>
            </div>
          );
        })}
      </section>

      {arkJobs && (
        <section className="card flex flex-col gap-1 rounded-[14px]">
          <span className="text-base font-medium">Job board on Arkiv</span>
          <span className="pb-1 text-xs text-muted">Every cleaning escrow the building opened. Anyone can check it.</span>
          {arkJobs.map((j) => (
            <BoardRow key={j.key} j={j} />
          ))}
        </section>
      )}

      {w.address && <WorkReceipts address={w.address} />}

      {!hero.live && !arkJobs && (
        <section className="card flex flex-col gap-1 rounded-[14px]">
          <span className="pb-1 text-base font-medium">Paid jobs</span>
          {cleaner.paid.map((p) => (
            <div key={p.id} className="flex items-center justify-between py-1.5 text-sm">
              <span className="flex flex-col">
                <span className="font-medium">
                  Job #{p.id} · {p.when}
                </span>
                <span className="text-xs text-muted">{p.text}</span>
              </span>
              <span className="text-xs font-medium text-muted">{p.amount.toFixed(2)} USDC</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

/** The cleaner's work history: Arkiv receipts the building created but the cleaner's wallet owns. */
function WorkReceipts({ address }) {
  const r = useArkiv(() => fetchWorkReceipts({ cleaner: address }), null, [address]);
  const list = (r.live || r.limited) && Array.isArray(r.data) ? r.data : null;
  return (
    <section className="card flex flex-col gap-1 rounded-[14px]">
      <span className="text-base font-medium">Your work receipts</span>
      <span className="pb-1 text-xs text-muted">One Arkiv receipt per paid job. The building creates it, your wallet owns it.</span>
      {!list && <span className="text-xs text-muted">{r.limited ? "Arkiv busy, retrying" : r.error ? "Couldn't read Arkiv right now." : "Loading…"}</span>}
      {list?.length === 0 && <span className="text-sm text-muted">No receipts yet. The first one arrives in your wallet when a job pays out.</span>}
      {list?.map((w) => (
        <div key={w.key} className="flex flex-col gap-1.5 border-t border-line py-2.5 text-sm first-of-type:border-0">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{w.jobId != null ? `Job #${w.jobId}` : `Case ${w.caseId ?? ""}`}</span>
            <span className="text-[13px] font-medium">{(Number(w.feeUsdc) || 0).toFixed(2)} USDC</span>
          </div>
          <span className="flex flex-wrap items-center gap-2 text-[11px]">
            {w.dustyPct != null && (
              <span className="text-muted">
                {Math.round(w.dustyPct)}%{w.afterPct != null ? ` → ${Math.round(w.afterPct)}%` : ""} output
              </span>
            )}
            {w.paidAt && <span className="text-muted">{new Date(w.paidAt * 1000).toLocaleDateString([], { day: "numeric", month: "short" })}</span>}
            <Proof kind="arc" id={w.releaseTx} />
            <Proof kind="arkiv" id={w.key} label="Arkiv" />
          </span>
          {w.owner && w.owner.toLowerCase() === address.toLowerCase() && (
            <span className="text-[11px] text-muted">In your wallet: the committee can't delete it.</span>
          )}
        </div>
      ))}
    </section>
  );
}

// One job on the Arkiv board. Works with the v2 and v3 cleaning_job fields: a v3 case has no
// Arc id or fee until the committee approves it.
const GOOD = new Set(["paid", "resolved"]);
const BAD = new Set(["refunded", "rejected", "disputed", "no_check"]);
function BoardRow({ j }) {
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const device = usePiDevice();
  const fee = Number(j.feeUsdc) || 0;
  const before = j.dustyPct ?? j.outputBefore;
  const after = j.afterPct ?? j.outputAfter;
  const tx = j.releaseTx || j.refundTx || j.openTx || j.arcTx;
  const canVerify = j.status === "paid" && j.jobId != null && ARC_READY.escrow;
  const verify = async () => {
    setBusy(true);
    try {
      setRes(await verifyPayout({ id: j.jobId, proofWindow: j.proofWindow }, device));
    } catch (e) {
      setRes({ ok: false, why: e.shortMessage || e.message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-1.5 border-t border-line py-2.5 text-sm first-of-type:border-0">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{j.jobId != null ? `Job #${j.jobId}` : j.caseId != null ? `Case ${j.caseId}` : "Cleaning request"}</span>
        <span className={`chip py-0.5 text-[11px] ${GOOD.has(j.status) ? "bg-[rgba(47,158,106,0.16)] text-good" : BAD.has(j.status) ? "bg-[rgba(180,35,24,0.12)] text-bad" : "bg-sun-soft text-sun-ink"}`}>
          {j.status}
          {fee > 0 ? ` · ${fee.toFixed(2)} USDC` : ""}
        </span>
      </div>
      <span className="flex flex-wrap items-center gap-2 text-[11px]">
        {before != null && (
          <span className="text-muted">
            {Math.round(before)}%{after != null ? ` → ${Math.round(after)}%` : ""} output
          </span>
        )}
        {j.coveragePct != null && <span className="text-muted">0G: ~{Math.round(j.coveragePct)}% covered</span>}
        <Proof kind="arc" id={tx} />
        <Proof kind="og" id={j.ogStorageRoot} />
        <Proof kind="arkiv" id={j.key} />
        {canVerify && (
          <button type="button" className="text-[11px] text-link underline-offset-2 hover:underline" onClick={verify} disabled={busy}>
            {busy ? "verifying…" : "Verify payout"}
          </button>
        )}
      </span>
      {res && (
        <span className={`text-[11.5px] ${res.ok ? "text-good" : "text-bad"}`}>
          {res.ok
            ? `✓ Signed by the Pi's device key (${res.signer.slice(0, 6)}…${res.signer.slice(-4)}) and matches the proof on Arc`
            : `✗ ${res.why || (!res.signaturesOk ? "A reading isn't signed by the Pi" : "Doesn't match the proof on Arc")}`}
        </span>
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

  if (["clean", "dusty", "flagged"].includes(hero.stage) || !j) {
    const flagged = hero.stage === "flagged";
    return (
      <section className="card flex flex-col gap-2 rounded-[14px] text-sm">
        <span className="text-[11px] font-medium tracking-wider text-muted">
          {flagged ? "A JOB IS WAITING FOR APPROVAL" : hero.stage === "dusty" ? "A PANEL IS BEING CHECKED" : "NO JOBS RIGHT NOW"}
        </span>
        <span className="text-base font-medium">
          {flagged
            ? "0G says a panel near you is dirty. The committee approves before the fee is locked and the job opens."
            : hero.stage === "dusty"
              ? "A panel near you dropped in output. 0G looks at it before anything is posted."
              : "All panels near you are clean."}
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

  const markDone = async () => {
    setBusy(true);
    setErr(null);
    try {
      await hero.actions.done();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (hero.stage === "disputed" || hero.stage === "resolved") {
    const r = j.resolution;
    return (
      <section className="card flex flex-col gap-3 rounded-[14px]">
        <span className="text-[11px] font-medium tracking-wider text-bad">{hero.stage === "disputed" ? "DISPUTED" : "RESOLVED"} · JOB #{j.id}</span>
        <span className="text-base font-medium">
          {hero.stage === "disputed"
            ? `${j.fee.toFixed(2)} USDC stays locked. The committee decides: pay you or refund the society.`
            : r === "paid"
              ? `The committee paid you ${j.fee.toFixed(2)} USDC.`
              : r === "refunded"
                ? "The committee refunded the society."
                : "The committee resolved the dispute."}
        </span>
        <span className="text-xs text-muted">The committee wallet decides disputes, not the Pi.</span>
        <span className="flex flex-wrap gap-2 text-xs">
          <Proof kind="arc" id={j.releaseTx || j.refundTx} label="Arc tx" />
        </span>
      </section>
    );
  }

  if (hero.stage === "paid" || hero.stage === "refunded") {
    const paid = hero.stage === "paid";
    return (
      <section className={`card flex flex-col gap-3 rounded-[14px] ${paid ? "border-2 border-good" : ""}`}>
        <span className={`text-[11px] font-medium tracking-wider ${paid ? "text-good" : "text-bad"}`}>
          {paid ? "PAID BY THE SUN" : "REFUNDED TO THE SOCIETY"} · JOB #{j.id}
        </span>
        <span className="text-4xl font-medium">{paid ? `+${j.fee.toFixed(2)} USDC` : `${j.fee.toFixed(2)} USDC`}</span>
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
        <VerifyPayout hero={hero} />
      </section>
    );
  }

  return (
    <section className="card flex flex-col gap-3 rounded-[14px]">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium tracking-wider text-sun-ink">
          {hero.stage === "open" ? "NEW JOB NEAR YOU" : mine ? "YOUR JOB" : "TAKEN"} · #{j.id}
        </span>
        <span className="text-xs text-muted">Ends {ends(j.deadline)}</span>
      </div>
      <span className="flex flex-col gap-0.5">
        <span className="text-lg font-medium">Sunrise Apartments</span>
        <span className="text-sm text-muted">Andheri East · 1 roof panel · was at {Math.round(j.outputBefore)}% output</span>
      </span>
      <div className="inner flex items-center justify-between p-3">
        <span className="flex items-center gap-2 text-sm">
          <Icon name="lock" size={16} /> Locked in escrow on Arc
        </span>
        <span className="text-lg font-medium">{j.fee.toFixed(2)} USDC</span>
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
          <button type="button" className="btn min-h-[56px] text-base" disabled={busy} onClick={markDone}>
            {busy ? "Telling the Pi…" : "Mark done · let the meter check"}
          </button>
        </>
      )}

      {(hero.stage === "cleaning" || (hero.stage === "accepted" && !mine)) && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium">{mine ? "The meter is checking your work" : `Another cleaner (${short(j.cleaner)}) took this job`}</span>
            <span className={`text-3xl font-medium ${pct != null && pct >= hero.cleanPct ? "text-good" : ""}`}>{pct ?? "–"}%</span>
          </div>
          <div className="relative h-4 overflow-hidden rounded-full bg-inner">
            <span className="absolute inset-y-0 left-0 rounded-full bg-sun transition-[width] duration-300" style={{ width: `${Math.min(pct ?? 0, 100)}%` }} />
            <span className="absolute inset-y-0 w-1 bg-good" style={{ left: `${hero.cleanPct}%` }} title={`Pays at ${hero.cleanPct}%`} />
          </div>
          <span className="text-xs text-muted">
            The contract pays on meter proof, not on your word: {j.fee.toFixed(2)} USDC is released automatically once the panel holds {hero.cleanPct}%+ for a minute
            {hero.dustyPct != null ? ` and is at least ${hero.minGain ?? 15} points above the dusty ${Math.round(hero.dustyPct)}%` : ""}.
          </span>
        </div>
      )}

      {mine && <DisputeButton hero={hero} />}
      {acceptTx && <Proof kind="arc" id={acceptTx} label="Accepted on Arc" className="self-center text-xs" />}
      {err && <span className="text-center text-xs text-bad">{err}</span>}
    </section>
  );
}
