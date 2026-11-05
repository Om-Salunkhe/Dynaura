import { useState } from "react";
import Icon from "../components/Icon.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { panel } from "../data/demo.js";

export default function PanelHealth() {
  const [fee, setFee] = useState(panel.fee.toFixed(2));
  const [deadline, setDeadline] = useState(panel.deadline);
  const [posted, setPosted] = useState(false);
  const pct = panel.pct;

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
          style={{ background: `conic-gradient(var(--bad) 0 ${pct}%, var(--idle) ${pct}% 100%)` }}
        >
          <div className="grid h-[72px] w-[72px] place-items-center rounded-full bg-card-solid text-center leading-tight">
            <span>
              <span className="block text-lg font-extrabold">{pct}%</span>
              <span className="text-[10px] text-muted">of forecast</span>
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-extrabold tracking-wider text-bad">DUST ALERT FROM 0G</span>
          <span className="text-sm font-bold">Clear sky, but the panel is making half its usual power.</span>
          <span className="text-xs text-muted">Alert line is {panel.alertLine}%</span>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="card flex flex-col gap-0.5 rounded-[20px] p-3.5">
          <span className="text-xs text-muted">Forecast now</span>
          <span className="text-xl font-extrabold">{panel.forecastW.toFixed(2)} W</span>
        </div>
        <div className="card flex flex-col gap-0.5 rounded-[20px] p-3.5">
          <span className="text-xs text-muted">Actual now</span>
          <span className="text-xl font-extrabold text-bad">{panel.actualW.toFixed(2)} W</span>
        </div>
      </div>

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
            <input className="bg-transparent text-lg font-extrabold text-ink outline-none" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </label>
        </div>
        <ul className="flex flex-col gap-1.5 text-xs text-ink-2">
          <li className="flex gap-2"><Icon name="lock" size={14} /> The fee locks in escrow on Arc</li>
          <li className="flex gap-2"><Icon name="check" size={14} /> Releases when output is back above 90%</li>
          <li className="flex gap-2"><Icon name="back" size={14} /> Refunds to the society after the deadline</li>
        </ul>
        <button type="button" className="btn min-h-[52px] text-[15px]" disabled={posted} onClick={() => setPosted(true)}>
          {posted ? "Job posted (demo)" : `Lock ${Number(fee || 0).toFixed(2)} USDC and post`}
        </button>
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
