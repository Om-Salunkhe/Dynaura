/** Small pill that shows whether data is live from the Pi or demo data. */
export default function DemoBadge({ demo }) {
  return (
    <span
      className={`chip py-1 text-[11px] ${demo ? "bg-inner text-muted" : "bg-sun-soft text-sun-ink"}`}
      title={demo ? "Pi not reachable: showing demo data" : "Live from the Pi"}
    >
      <span className={`h-2 w-2 rounded-full ${demo ? "bg-idle" : "animate-pulse bg-sun"}`} />
      {demo ? "Demo" : "Live"}
    </span>
  );
}
