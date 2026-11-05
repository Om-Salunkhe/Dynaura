import { useState } from "react";
import Icon from "../components/Icon.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { panel } from "../data/demo.js";
import { postJSON, useLive } from "../lib/api.js";
import { txUrl } from "../lib/arc.js";

const DEADLINES = [
  { min: 60, label: "1 hour" },
  { min: 360, label: "6 hours" },
  { min: 1440, label: "24 hours" },
];

export default function PanelHealth() {
  const live = useLive();
  const c = !live.demo && live.cleaning ? live.cleaning : null;
  const [fee, setFee] = useState(panel.fee.toFixed(2));
  const [deadline, setDeadline] = useState(60);
  const [posted, setPosted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const pct = c?.pct != null ? Math.round(c.pct) : c ? 100 : panel.pct;
  const alertLine = c?.dust_pct ?? panel.alertLine;
  const dusty = pct < alertLine;
  const job = c?.job;

  const post = async () => {
    if (!c) return setPosted(true); // demo
    setBusy(true);
    setErr(null);
    try {
      await postJSON("/api/admin/cleaning", { fee_usdc: Number(fee), deadline_min: deadline }, { admin: true });
      setPosted(true);
    } catch (e) {
      setErr(`${e.message}. Is Arc set up on the Pi (ARC_PRIVATE_KEY, ARC_ESCROW) and does its wallet hold USDC?`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        kicker="Admin · Sunrise Apartments"
        title="Panel health"
        right={<span className="rounded-md bg-btn px-2 py-1 text-[11px] font-extrabold tracking-wider text-btn-ink">ADMIN</span>}
      />

      <section className="card flex items-center gap-4 rounded-[26px]">
        <div
          className="grid h-24 w-24 flex-none place-items-center rounded-full"
          style={{ background: `conic-gradient(var(${dusty ? "--bad" : "--sun"}) 0 ${pct}%, var(--idle) ${pct}% 100%)` }}
        >
          <div className="grid h-[72px] w-[72px] place-items-center rounded-full bg-card-solid text-center leading-tight">
            <span>
              <span className="block text-lg font-extrabold">{pct}%</span>
              <span className="text-[10px] text-muted">{c ? "of clean" : "of forecast"}</span>
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          {dusty ? (
            <>
              <span className="text-[11px] font-extrabold tracking-wider text-bad">DUST ALERT</span>
              <span className="text-sm font-bold">The panel is making {pct}% of what a clean panel makes in the same light.</span>
            </>
          ) : (
            <>
              <span className="text-[11px] font-extrabold tracking-wider text-sun-ink">PANEL IS CLEAN</span>
              <span className="text-sm font-bold">Output is where it should be.</span>
            </>
          )}
          <span className="text-xs text-muted">Alert line is {alertLine}%{c ? " · live from the meter" : " · demo"}</span>
        </div>
      </section>

      {!c && <div className="grid grid-cols-2 gap-2.5">
        <div className="card flex flex-col gap-0.5 rounded-[20px] p-3.5">
          <span className="text-xs text-muted">Forecast now</span>
          <span className="text-xl font-extrabold">{panel.forecastW.toFixed(2)} W</span>
        </div>
        <div className="card flex flex-col gap-0.5 rounded-[20px] p-3.5">
          <span className="text-xs text-muted">Actual now</span>
          <span className="text-xl font-extrabold text-bad">{panel.actualW.toFixed(2)} W</span>
        </div>
      </div>}

      {job && (
        <section className="card flex flex-col gap-2 rounded-[26px] text-sm">
          <div className="flex items-center justify-between">
            <span className="font-bold">Cleaning job #{job.job_id}</span>
            <span className="chip bg-sun-soft py-1 text-xs text-sun-ink">{job.status}</span>
          </div>
          <span className="text-muted">
            {job.fee_usdc.toFixed(2)} USDC locked · {job.cleaner ? `cleaner ${job.cleaner.slice(0, 6)}…` : "waiting for a cleaner"} · pays at {c.clean_pct}%
          </span>
          {job.open_tx && (
            <a className="text-xs font-bold text-link" href={txUrl(job.open_tx)} target="_blank" rel="noreferrer">
              Escrow opened on Arc · view tx
            </a>
          )}
        </section>
      )}

      <section className="card flex flex-col gap-3 rounded-[26px]">
        <span className="text-base font-bold">Post a cleaning job</span>
        <div className="grid grid-cols-2 gap-2.5">
          <label className="inner flex flex-col gap-1 p-3 text-xs text-muted">
            Fee (USDC)
            <input
              className="bg-transparent text-lg font-extrabold text-ink outline-none"
              inputMode="decimal"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
            />
          </label>
          <label className="inner flex flex-col gap-1 p-3 text-xs text-muted">
            Deadline
            <select
              className="bg-transparent text-lg font-extrabold text-ink outline-none"
              value={deadline}
              onChange={(e) => setDeadline(Number(e.target.value))}
            >
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
          <li className="flex gap-2"><Icon name="check" size={14} /> Releases when output is back above 90%</li>
          <li className="flex gap-2"><Icon name="back" size={14} /> Refunds to the society after the deadline</li>
        </ul>
        <button type="button" className="btn min-h-[52px] text-[15px]" disabled={posted || busy || !!job} onClick={post}>
          {job ? "A job is already open" : busy ? "Locking on Arc…" : posted ? (c ? "Job posted on Arc" : "Job posted (demo)") : `Lock ${Number(fee || 0).toFixed(2)} USDC and post`}
        </button>
        {c?.state === "dusty" && c.arc && !job && <span className="text-center text-xs text-muted">The Pi posts this by itself after a minute under {alertLine}%.</span>}
        {err && <span className="text-center text-xs text-bad">{err}</span>}
      </section>

      <section className="card flex items-center justify-between rounded-[26px]">
        <span className="flex flex-col">
          <span className="text-sm font-bold">Panel record on Arkiv</span>
          <span className="text-xs text-muted">{panel.record}</span>
        </span>
        <a href="#" className="text-sm font-bold text-link">
          View
        </a>
      </section>
    </div>
  );
}
