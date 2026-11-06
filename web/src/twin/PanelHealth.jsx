import Proof from "../components/Proof.jsx";
import { useLive } from "../lib/api.js";
import { useHero } from "../lib/hero.js";
import Frame, { w } from "./Frame.jsx";

export default function TwinPanelHealth() {
  const hero = useHero(useLive());
  const j = hero.job;
  return (
    <Frame
      screen="Panel health"
      rows={[
        ["stage", hero.stage],
        ["output", hero.pct != null ? `${Math.round(hero.pct)}% of clean` : null],
        ["expected / actual", `${w(hero.expectedW) ?? "–"} / ${w(hero.actualW) ?? "–"}`],
        ["lines", `alert ${hero.dustPct}% · pays ${hero.cleanPct}%`],
        ["job", j ? `#${j.id} · ${j.fee.toFixed(2)} USDC` : null],
      ]}
    >
      {j && (
        <span className="flex flex-wrap gap-1.5 text-[11px]">
          <Proof kind="arc" id={j.openTx} label="Escrow" />
          <Proof kind="og" id={hero.og?.open} />
          <Proof kind="arc" id={j.releaseTx} label="Released" />
          <Proof kind="og" id={hero.og?.paid} />
        </span>
      )}
      {!hero.live && (
        <button type="button" className="btn-ghost self-start" onClick={hero.stage === "clean" ? hero.actions.dust : hero.actions.reset}>
          {hero.stage === "clean" ? "Demo: put dust on" : "Demo: reset"}
        </button>
      )}
    </Frame>
  );
}
