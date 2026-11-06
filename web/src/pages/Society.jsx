import { useEffect, useState } from "react";
import Icon from "../components/Icon.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { plan as demoPlan } from "../data/demo.js";
import { planToView } from "../data/society.js";
import { postJSON, shortId, usePi } from "../lib/api.js";
import { useRole } from "../lib/role.jsx";

const DAY_START = 9; // 9 AM
const DAY_END = 15; // 3 PM
const TICKS = [9, 11, 13, 15];
const hourLabel = (h) => (h === 13 ? "1 PM" : h === 15 ? "3" : h > 12 ? h - 12 : h);
const fmt = (h) => `${Math.floor(h)}:${h % 1 ? "30" : "00"}`;

export default function Society() {
  const [who] = useRole();
  const isAdmin = who.role === "admin";
  const api = usePi("/api/plan", null);
  const live = !api.demo && api.data?.plan;
  const [plan, setPlan] = useState(demoPlan);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (live) setPlan(planToView(api.data, api.data.runner?.jobs));
  }, [api.data, live]);

  const replan = async () => {
    setBusy(true);
    setErr("");
    try {
      api.set(await postJSON("/api/plan/run?which=today", {}, { admin: true }));
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };
  const total = plan.split.flats + plan.split.common + plan.split.buffer;

  const move = (gi, ji, start) => {
    const job = plan.groups[gi].jobs[ji];
    if (live && job.id) {
      const hh = `${String(Math.floor(start)).padStart(2, "0")}:${start % 1 ? "30" : "00"}`;
      postJSON("/api/admin/jobs", { id: job.id, start: hh }, { admin: true })
        .then((d) => api.set({ ...api.data, ...d }))
        .catch((e) => setErr(String(e.message || e)));
    }
    setPlan((p) => ({
      ...p,
      groups: p.groups.map((g, i) =>
        i !== gi
          ? g
          : {
              ...g,
              jobs: g.jobs.map((j, k) =>
                k !== ji ? j : { ...j, start, label: `${fmt(start)} · ${j.hours >= 1 ? `${j.hours} h` : "30 min"}`, running: false }
              ),
            }
      ),
    }));
  };

  const noAi = !api.demo && api.data?.mode === "no-ai";

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        kicker={`Sunrise Apartments · ${plan.date}`}
        title="Spare sun runs the building."
      />

      {noAi && (
        <section className="card flex flex-col gap-1 rounded-[22px] border-bad">
          <span className="text-[11px] font-extrabold tracking-wider text-bad">NO-AI MODE</span>
          <span className="text-sm font-bold">0G could not be reached, so nothing was moved. Every flat is on grid.</span>
          <span className="text-xs text-muted">{api.data.reason}</span>
        </section>
      )}

      <section className="card flex flex-col gap-3 rounded-[26px]">
        {!isAdmin && (
          <span className="chip w-fit border border-line bg-card-solid py-1.5 text-xs font-semibold">
            <Icon name="lock" size={14} /> Set by committee · view only
          </span>
        )}
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted">Solar forecast for the day</span>
          <span className="text-2xl font-extrabold">{plan.forecastKwh} kWh</span>
        </div>
        <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
          <span className="bg-sun" style={{ width: `${(plan.split.flats / total) * 100}%` }} />
          <span className="bg-[#2F9E6A]" style={{ width: `${(plan.split.common / total) * 100}%` }} />
          <span className="bg-idle" style={{ width: `${(plan.split.buffer / total) * 100}%` }} />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-2">
          <Dot c="bg-sun" t={`Flats ${plan.split.flats}`} />
          <Dot c="bg-[#2F9E6A]" t={`Common area ${plan.split.common}`} />
          <Dot c="bg-idle" t={`Buffer ${plan.split.buffer}`} />
        </div>
      </section>

      <section className="card flex flex-col gap-2 rounded-[26px]">
        <div className="flex items-center justify-between">
          <span className="text-base font-bold">Planned by 0G</span>
          <span className="mono text-[11px] text-muted" title={plan.requestId}>{shortId(plan.requestId)}</span>
        </div>
        {plan.summary && <span className="text-xs text-ink-2">{plan.summary}</span>}
        <div className="grid grid-cols-[112px_1fr] gap-2 text-[11px] text-muted">
          <span />
          <span className="flex justify-between">
            {TICKS.map((t) => (
              <span key={t}>{hourLabel(t)}</span>
            ))}
          </span>
        </div>

        {plan.groups.map((g, gi) => (
          <div key={g.name} className="flex flex-col gap-1.5">
            <span className="pt-1 text-[11px] font-extrabold uppercase tracking-wider text-muted">
              {gi + 1} · {g.name}
            </span>
            {g.jobs.map((j, ji) => {
              const left = ((j.start - DAY_START) / (DAY_END - DAY_START)) * 100;
              const width = (j.hours / (DAY_END - DAY_START)) * 100;
              const key = `${gi}-${ji}`;
              return (
                <div key={j.name} className="flex flex-col gap-1">
                  <div className="grid grid-cols-[112px_1fr] items-center gap-2">
                    <span className="flex flex-col">
                      <span className="text-[13px] font-bold leading-tight">{j.name}</span>
                      <span className={`text-[11px] ${j.running ? "font-bold text-sun-ink" : "text-muted"}`}>{j.label}</span>
                    </span>
                    <span className="relative h-7 rounded-lg bg-inner">
                      <span
                        className={`absolute top-1 bottom-1 rounded-md ${j.running ? "animate-pulse bg-sun" : "bg-sun opacity-80"}`}
                        style={{ left: `${left}%`, width: `${width}%` }}
                      />
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => setEditing(editing === key ? null : key)}
                          className="absolute -right-1 -top-1 rounded-full border border-line bg-card-solid px-2 text-[11px] font-bold"
                        >
                          Edit
                        </button>
                      )}
                    </span>
                  </div>
                  {isAdmin && editing === key && (
                    <label className="inner ml-[120px] flex items-center justify-between gap-2 px-3 py-2 text-xs">
                      Start at
                      <select
                        className="rounded-lg border border-line bg-card-solid px-2 py-1 text-ink"
                        value={j.start}
                        onChange={(e) => move(gi, ji, Number(e.target.value))}
                      >
                        {Array.from({ length: (DAY_END - DAY_START) * 2 }, (_, i) => DAY_START + i / 2)
                          .filter((h) => h + j.hours <= DAY_END)
                          .map((h) => (
                            <option key={h} value={h}>
                              {fmt(h)}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </section>

      {isAdmin && (
        <div className="flex flex-col gap-1">
          <button type="button" className="btn-ghost" onClick={replan} disabled={busy}>
            {busy ? "Asking 0G…" : "Re-plan today on 0G"}
          </button>
          {err && <span className="px-1 text-xs text-bad">{err}</span>}
        </div>
      )}

      <p className="px-1 text-xs leading-relaxed text-muted">
        Only the committee admin can add or change jobs. Lifts, corridor lights and CCTV always stay on grid. If tomorrow is
        cloudy, garden and pool move to the next sunny day.
      </p>
    </div>
  );
}

function Dot({ c, t }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-sm ${c}`} />
      {t}
    </span>
  );
}
