/** Hour bars split into solar (amber) and grid (blue). null = future hour. */
export default function StackBars({ data, nowIndex, height = 64, gap = 6 }) {
  return (
    <div className="grid items-end" style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0,1fr))`, height, columnGap: gap }}>
      {data.map((d, i) => {
        if (!d) return <div key={i} className="h-[8%] rounded bg-idle" />;
        const [solar, grid] = d;
        const total = Math.max(solar + grid, 0.04);
        return (
          <div key={i} className="flex flex-col gap-0.5" style={{ height: `${Math.min(total, 1) * 100}%` }}>
            {grid > 0 && <div className="rounded-t bg-grid" style={{ flex: grid }} />}
            {solar > 0 && (
              <div
                className={`rounded-b bg-sun ${grid > 0 ? "" : "rounded-t"} ${i === nowIndex ? "ring-2 ring-ink" : ""}`}
                style={{ flex: solar }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
