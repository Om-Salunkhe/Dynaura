import { useState } from "react";
import Icon from "../components/Icon.jsx";
import PageHeader from "../components/PageHeader.jsx";
import WalletButton from "../components/WalletButton.jsx";
import { cleaner } from "../data/demo.js";
import { useLive } from "../lib/api.js";
import { ARC_READY, errText, short, txUrl, useWallet, write } from "../lib/arc.js";

const STEPS = ["Accept and clean", "The meter watches the panel", "Back at 90%+ for a minute: USDC is yours"];

const ends = (ts) => new Date(ts * 1000).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

export default function CleanerJobs() {
  const live = useLive();
  const w = useWallet();
  const c = live.cleaning;
  const isLive = !live.demo && c?.arc && ARC_READY.escrow;

  return (
    <div className="flex flex-col gap-3">
      <PageHeader kicker={`Hi, ${cleaner.name}`} title="Clean panels. Get paid by the sun." right={<WalletButton />} />
      {isLive ? <LiveJob c={c} me={w.address} /> : <DemoJob />}

      <section className="card flex flex-col gap-2 rounded-[26px]">
        <span className="text-base font-bold">How you get paid</span>
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-3 text-sm">
            <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-btn text-xs font-extrabold text-btn-ink">{i + 1}</span>
            {s}
          </div>
        ))}
      </section>
    </div>
  );
}

function LiveJob({ c, me }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [tx, setTx] = useState(null);
  const job = c.job;
  const mine = job?.cleaner && me && job.cleaner.toLowerCase() === me.toLowerCase();
  const pct = c.pct != null ? `${Math.round(c.pct)}%` : "–";

  const accept = async () => {
    setBusy(true);
    setErr(null);
    try {
      setTx(await write("escrow", "accept", [BigInt(job.job_id)]));
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="card flex flex-col gap-0.5 rounded-[20px] p-3.5">
          <span className="text-xs text-muted">Panel output now</span>
          <span className={`text-xl font-extrabold ${c.pct != null && c.pct < c.dust_pct ? "text-bad" : ""}`}>{pct}</span>
        </div>
        <div className="card flex flex-col gap-0.5 rounded-[20px] p-3.5">
          <span className="text-xs text-muted">Pays out at</span>
          <span className="text-xl font-extrabold">{c.clean_pct}%</span>
        </div>
      </div>

      {job ? (
        <section className="card flex flex-col gap-3 rounded-[26px]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-extrabold tracking-wider text-sun-ink">
              {job.status === "open" ? "NEW JOB NEAR YOU" : mine ? "YOUR JOB" : "TAKEN"} · #{job.job_id}
            </span>
            <span className="text-xs text-muted">Ends {ends(job.deadline)}</span>
          </div>
          <span className="flex flex-col gap-0.5">
            <span className="text-lg font-extrabold">Sunrise Apartments</span>
            <span className="text-sm text-muted">1 roof panel · was at {Math.round(job.output_before)}% output</span>
          </span>
          <div className="inner flex items-center justify-between p-3">
            <span className="flex items-center gap-2 text-sm">
              <Icon name="lock" size={16} /> Locked in escrow on Arc
            </span>
            <span className="text-lg font-extrabold">{job.fee_usdc.toFixed(2)} USDC</span>
          </div>
          {job.status === "open" && (
            <button type="button" className="btn min-h-[52px] text-[15px]" disabled={busy} onClick={accept}>
              {busy ? "Confirm in your wallet…" : "Accept job"}
            </button>
          )}
          {job.status === "accepted" && mine && (
            <span className="chip justify-center bg-sun-soft py-3 text-center text-sun-ink">
              Clean the panel. The meter sees {pct} now and pays you at {c.clean_pct}%.
            </span>
          )}
          {job.status === "accepted" && !mine && <span className="text-center text-sm text-muted">Another cleaner ({short(job.cleaner)}) took this job.</span>}
          {tx && (
            <a className="text-center text-xs font-bold text-link" href={txUrl(tx)} target="_blank" rel="noreferrer">
              Accepted on Arc · view tx
            </a>
          )}
          {err && <span className="text-center text-xs text-bad">{err}</span>}
        </section>
      ) : (
        <section className="card flex flex-col gap-1 rounded-[26px] text-sm">
          <span className="font-bold">No cleaning jobs right now</span>
          <span className="text-muted">A job appears here when the panel drops under {c.dust_pct}% of its clean output.</span>
        </section>
      )}

      {c.last && (
        <section className="card flex items-center justify-between rounded-[26px] text-sm">
          <span className="flex flex-col">
            <span className="font-bold">
              Job #{c.last.job_id} · {c.last.status === "paid" ? "paid" : "refunded to society"}
            </span>
            <span className="text-xs text-muted">
              {Math.round(c.last.output_before)}%{c.last.output_after != null ? ` to ${Math.round(c.last.output_after)}%` : ""} output
            </span>
          </span>
          <a href={txUrl(c.last.release_tx || c.last.refund_tx)} target="_blank" rel="noreferrer" className="text-xs font-bold text-link">
            {c.last.fee_usdc.toFixed(2)} · Arc tx
          </a>
        </section>
      )}
    </>
  );
}

function DemoJob() {
  const [stage, setStage] = useState("new"); // new -> accepted -> done
  const j = cleaner.job;
  return (
    <>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="card flex flex-col gap-0.5 rounded-[20px] p-3.5">
          <span className="text-xs text-muted">Earned this month</span>
          <span className="text-xl font-extrabold">{cleaner.earned.toFixed(2)} USDC</span>
        </div>
        <div className="card flex flex-col gap-0.5 rounded-[20px] p-3.5">
          <span className="text-xs text-muted">Jobs done</span>
          <span className="text-xl font-extrabold">{cleaner.done}</span>
        </div>
      </div>

      <section className="card flex flex-col gap-3 rounded-[26px]">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-extrabold tracking-wider text-sun-ink">NEW JOB NEAR YOU</span>
          <span className="text-xs text-muted">{j.ends}</span>
        </div>
        <span className="flex flex-col gap-0.5">
          <span className="text-lg font-extrabold">{j.building}</span>
          <span className="text-sm text-muted">{j.where}</span>
        </span>
        <div className="inner flex items-center justify-between p-3">
          <span className="flex items-center gap-2 text-sm">
            <Icon name="lock" size={16} /> Locked in escrow on Arc
          </span>
          <span className="text-lg font-extrabold">{j.fee.toFixed(2)} USDC</span>
        </div>
        {stage === "new" && (
          <button type="button" className="btn min-h-[52px] text-[15px]" onClick={() => setStage("accepted")}>
            Accept job
          </button>
        )}
        {stage === "accepted" && (
          <button type="button" className="btn min-h-[52px] text-[15px]" onClick={() => setStage("done")}>
            Mark done
          </button>
        )}
        {stage === "done" && <span className="chip justify-center bg-sun-soft py-3 text-sun-ink">Waiting for the meter to see 90%+ (demo)</span>}
      </section>

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
            <span className="text-xs font-bold text-link">{p.amount.toFixed(2)} · Arc tx</span>
          </div>
        ))}
      </section>
    </>
  );
}
