// The cleaning escrow as a clean 5-step strip. Only the current step is lit.
import { stageIndex } from "../lib/hero.js";

const STEPS = ["Dust seen", "Escrow open", "Cleaner accepted", "Meter ≥ 90%", "Paid"];

export default function EscrowStrip({ hero, size = "app" }) {
  const label = (n) => (n === 4 && hero.stage === "refunded" ? "Refunded" : STEPS[n]);
  const i = stageIndex(hero.stage); // clean 0 … paid 5, refunded 6
  const refunded = hero.stage === "refunded";
  const current = i === 0 ? -1 : Math.min(i, 5) - 1; // step index 0..4
  const big = size === "projector";
  const lit = refunded ? "var(--t-alert)" : i === 1 ? "var(--t-alert)" : i >= 5 ? "var(--t-paid)" : "var(--t-ink)";
  return (
    <div className="flex flex-col gap-2">
    <ol className="grid grid-cols-5 gap-2" aria-label="Cleaning escrow steps">
      {STEPS.map((label, n) => {
        const done = n < current || (i >= 5 && n < 4);
        const now = n === current;
        return (
          <li key={label} className="flex flex-col gap-2" aria-current={now ? "step" : undefined}>
            <span
              className="block rounded-full"
              style={{
                height: big ? 6 : 4,
                background: now ? lit : done ? "var(--t-ink-2)" : "var(--t-line)",
              }}
            />
            <span
              className={`${big ? "flex text-[24px]" : "hidden text-[13px] sm:flex"} items-baseline gap-1.5 leading-tight`}
              style={{ color: now ? "var(--t-ink)" : done ? "var(--t-ink-2)" : "var(--t-muted)", fontWeight: now ? 600 : 400 }}
            >
              <span className="t-num" style={{ color: "var(--t-muted)", fontWeight: 400 }}>
                {done ? "✓" : n + 1}
              </span>
              {n === 4 && refunded ? "Refunded" : label}
            </span>
          </li>
        );
      })}
    </ol>
    {!big && (
      <span className="text-[13px] sm:hidden" style={{ color: "var(--t-ink-2)" }}>
        {current < 0 ? "No escrow open" : `Step ${current + 1} of 5 · ${label(current)}`}
      </span>
    )}
    </div>
  );
}
