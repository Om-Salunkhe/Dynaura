import { useState } from "react";
import Icon from "../components/Icon.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { cleaner } from "../data/demo.js";

const STEPS = ["Accept and clean", "Tap Mark done", "The meter sees 90%+ and pays you"];

export default function CleanerJobs() {
  const [stage, setStage] = useState("new"); // new -> accepted -> done
  const j = cleaner.job;

  return (
    <div className="flex flex-col gap-3">
      <PageHeader kicker={`Hi, ${cleaner.name}`} title="Clean panels. Get paid by the sun." />

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
        {stage === "done" && (
          <span className="chip justify-center bg-sun-soft py-3 text-sun-ink">Waiting for the meter to see 90%+ (demo)</span>
        )}
      </section>

      <section className="card flex flex-col gap-2 rounded-[26px]">
        <span className="text-base font-bold">How you get paid</span>
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-3 text-sm">
            <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-btn text-xs font-extrabold text-btn-ink">{i + 1}</span>
            {s}
          </div>
        ))}
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
            <a href="#" className="text-xs font-bold text-link">
              {p.amount.toFixed(2)} · Arc tx
            </a>
          </div>
        ))}
      </section>
    </div>
  );
}
