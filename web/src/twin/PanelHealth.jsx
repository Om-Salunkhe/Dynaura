// Twin Panel health: the building with the panel's state on it, one live number with its
// comparison, a plain sentence (cause + next step), the escrow strip, and receipts.
import PageHeader from "../components/PageHeader.jsx";
import { useLive } from "../lib/api.js";
import { useHero } from "../lib/hero.js";
import { ManualPost } from "../pages/PanelHealth.jsx";
import BuildingTwin from "./BuildingTwin.jsx";
import EscrowStrip from "./EscrowStrip.jsx";
import OutputChart from "./OutputChart.jsx";
import Receipt from "./Receipt.jsx";
import { heroReceipts, statusLine, statusTag, twinBuilding, twinPanel } from "./data.js";
import { SCALE_NOTE, inr, kw, usdc } from "./format.js";

function OutputMeter({ hero }) {
  const p = Math.max(0, Math.min(100, hero.pct ?? 0));
  const low = hero.pct != null && hero.pct < hero.dustPct;
  const fill = hero.stage === "paid" ? "var(--t-paid)" : low ? "var(--t-alert)" : "var(--t-ink)";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative h-2 rounded-full" style={{ background: "var(--t-line)" }}>
        <span className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300" style={{ width: `${p}%`, background: fill }} />
        {[
          [hero.dustPct, "var(--t-alert)"],
          [hero.cleanPct, "var(--t-paid)"],
        ].map(([x, c]) => (
          <span key={x} className="absolute -top-1 h-4 w-0.5" style={{ left: `${x}%`, background: c }} />
        ))}
      </div>
      <div className="t-num relative h-4 text-[11px]" style={{ color: "var(--t-muted)" }}>
        <span className="absolute -translate-x-1/2" style={{ left: `${hero.dustPct}%` }}>
          alert {hero.dustPct}%
        </span>
        <span className="absolute -translate-x-1/2" style={{ left: `${hero.cleanPct}%` }}>
          pays {hero.cleanPct}%
        </span>
      </div>
    </div>
  );
}

export default function TwinPanelHealth() {
  const live = useLive();
  const hero = useHero(live);
  const b = twinBuilding(live);
  const [tag, tone] = statusTag(hero);
  const j = hero.job;
  const rows = heroReceipts(hero);
  const low = hero.pct != null && hero.pct < hero.dustPct && hero.stage !== "paid";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        kicker="Committee · Sunrise Apartments"
        title="Panel health"
        right={
          <span className="t-tag" style={{ color: tone }}>
            {tag}
          </span>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <section className="card flex flex-col justify-center gap-2 p-4 lg:p-6">
          <BuildingTwin b={b} panel={twinPanel(hero)} />
          <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>
            {SCALE_NOTE}
          </span>
        </section>

        <div className="flex flex-col gap-4">
          <section className="card flex flex-col gap-4 p-5">
            <span className="t-caps">Panel output now</span>
            <span className="flex flex-col gap-1">
              <span className="t-num flex items-baseline gap-2 leading-none">
                <span className="text-[56px] font-medium tracking-[-0.03em]" style={{ color: low ? "var(--t-alert)" : "var(--t-ink)" }}>
                  {hero.actualW != null ? kw(hero.actualW) : hero.pct != null ? Math.round(hero.pct) : "–"}
                </span>
                <span className="text-[22px]" style={{ color: "var(--t-muted)" }}>
                  {hero.actualW != null ? "kW" : "%"}
                </span>
              </span>
              <span className="t-num text-[15px]" style={{ color: "var(--t-ink-2)" }}>
                {hero.pct != null ? `${Math.round(hero.pct)}% of ` : ""}
                {hero.expectedW != null ? `${kw(hero.expectedW)} kW expected` : "a clean panel in this light"}
                {hero.idle ? " · no flat is drawing from the panel" : ""}
              </span>
            </span>
            <OutputMeter hero={hero} />
            <p className="m-0 text-[15px] leading-relaxed">{statusLine(hero)}</p>
            {!hero.live && ["clean", "paid", "refunded"].includes(hero.stage) && (
              <button type="button" className="btn-ghost self-start" onClick={hero.actions.dust}>
                Try it: put tracing paper on the panel (demo)
              </button>
            )}
            {hero.live && hero.error && <span className="text-[13px]" style={{ color: "var(--t-alert)" }}>Pi: {hero.error}</span>}
          </section>

          <section className="card flex flex-col gap-4 p-5">
            <div className="flex items-center justify-between">
              <span className="t-caps">Cleaning escrow</span>
              {j && <span className="t-num text-[12px]" style={{ color: "var(--t-muted)" }}>job #{j.id}</span>}
            </div>
            <EscrowStrip hero={hero} />
            {j ? (
              <span className="flex items-end justify-between gap-3">
                <span className="flex flex-col">
                  <span className="t-num text-[28px] font-medium leading-none">{usdc(j.fee)} USDC</span>
                  <span className="t-num text-[12px]" style={{ color: "var(--t-muted)" }}>
                    {inr(j.fee)} · {hero.stage === "paid" ? "paid to the cleaner" : hero.stage === "refunded" ? "back to the society" : "locked for the cleaner"}
                  </span>
                </span>
                <span className="t-tag" style={{ color: tone }}>
                  {tag}
                </span>
              </span>
            ) : (
              <span className="text-[14px]" style={{ color: "var(--t-muted)" }}>
                No escrow open. The Pi opens one by itself after a minute under {hero.dustPct}%.
              </span>
            )}
            {rows.length > 0 && (
              <div className="flex flex-col">
                {rows.map((r) => (
                  <Receipt key={r.title} {...r} />
                ))}
              </div>
            )}
            {hero.live && !hero.arc && (
              <span className="text-[12px]" style={{ color: "var(--t-muted)" }}>
                Arc escrow isn't set up on the Pi (ARC_ESCROW), so no job opens by itself.
              </span>
            )}
          </section>
        </div>
      </div>

      <OutputChart />
      {!j && <ManualPost hero={hero} />}
    </div>
  );
}
