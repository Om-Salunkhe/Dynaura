/** Hour bars split into solar (amber) and grid (blue). null = future hour. Slim columns. */
export default function StackBars({ data, nowIndex, height = 64, gap = 6 }) {
  return (
    <div className="grid items-end" style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0,1fr))`, height, columnGap: gap }}>
      {data.map((d, i) => {
        if (!d) return <div key={i} className="mx-auto h-[3px] w-full max-w-[14px] rounded-[2px] bg-idle" />;
        const [solar, grid] = d;
        const total = Math.max(solar + grid, 0.04);
        const now = i === nowIndex;
        const past = nowIndex != null && i < nowIndex;
        return (
          <div
            key={i}
            className={`mx-auto flex w-full max-w-[14px] flex-col gap-[2px] ${past ? "opacity-55" : ""}`}
            style={{ height: `${Math.min(total, 1) * 100}%` }}
          >
            {grid > 0 && <div className="rounded-t-[3px] bg-grid" style={{ flex: grid }} />}
            {solar > 0 && (
              <div
                className={`bg-sun ${grid > 0 ? "" : "rounded-t-[3px]"} ${now ? "shadow-[0_0_14px_rgba(245,165,60,0.55)]" : ""}`}
                style={{ flex: solar }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
