// Same list as pi/society.py: the building's shared jobs that can wait for the sun.
export const SOCIETY_JOBS = {
  tank: { name: "Overhead tank", group: "Water", icon: "water" },
  borewell: { name: "Borewell pump", group: "Water", icon: "water" },
  ro: { name: "RO drinking water", group: "Water", icon: "water" },
  ev: { name: "EV charge point", group: "Charging", icon: "car" },
  lift_battery: { name: "Lift backup battery", group: "Charging", icon: "bolt" },
  garden: { name: "Garden sprinklers", group: "Upkeep", icon: "leaf" },
  pool: { name: "Pool filter", group: "Upkeep", icon: "water" },
};
export const GROUPS = ["Water", "Charging", "Upkeep"];

const toHours = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h + m / 60;
};

const label = (start, minutes) => {
  const [h, m] = start.split(":").map(Number);
  const t = h === 12 ? `12:${String(m).padStart(2, "0")}` : h > 12 ? `${h - 12}${m ? `:${String(m).padStart(2, "0")}` : ""} PM` : start;
  return `${t} · ${minutes >= 60 ? `${+(minutes / 60).toFixed(1)} h` : `${minutes} min`}`;
};

/** Turn the Pi's /api/plan answer into the shape the Society screen draws. */
export function planToView(api, runnerJobs = {}) {
  const p = api.plan;
  const d = new Date(p.date + "T12:00:00");
  return {
    date: d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }),
    forecastKwh: p.forecast_kwh,
    split: p.split_kwh,
    requestId: api.request_id,
    summary: p.summary,
    groups: GROUPS.map((g) => ({
      name: g,
      jobs: p.jobs
        .filter((j) => SOCIETY_JOBS[j.id]?.group === g)
        .map((j) => ({
          id: j.id,
          name: SOCIETY_JOBS[j.id].name,
          icon: SOCIETY_JOBS[j.id].icon,
          start: toHours(j.start),
          hours: j.minutes / 60,
          label: runnerJobs[j.id] === "running" ? "Running now" : label(j.start, j.minutes),
          running: runnerJobs[j.id] === "running",
          why: j.why,
        })),
    })).filter((g) => g.jobs.length),
  };
}
