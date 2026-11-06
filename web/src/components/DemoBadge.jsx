/** Small pill that shows whether data is live from the Pi or demo data. */
export default function DemoBadge({ demo }) {
  return (
    <span
      className={`chip py-0.5 text-[11px] ${demo ? "border border-line text-muted" : "bg-sun-soft text-sun-ink"}`}
      title={demo ? "Pi not reachable: showing demo data" : "Live from the Pi"}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${demo ? "bg-[color:var(--muted)]" : "animate-pulse bg-sun"}`} />
      {demo ? "Demo" : "Live"}
    </span>
  );
}
