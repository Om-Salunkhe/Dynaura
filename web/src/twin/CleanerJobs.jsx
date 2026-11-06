import Proof from "../components/Proof.jsx";
import { useLive } from "../lib/api.js";
import { useHero } from "../lib/hero.js";
import Frame from "./Frame.jsx";

export default function TwinCleanerJobs() {
  const hero = useHero(useLive());
  const j = hero.job;
  const next = !hero.live && { open: ["Demo: accept", hero.actions.accept], accepted: ["Demo: mark done", hero.actions.done] }[hero.stage];
  return (
    <Frame
      screen="Cleaner"
      rows={[
        ["stage", hero.stage],
        ["job", j ? `#${j.id} · ${j.fee.toFixed(2)} USDC · was ${Math.round(j.outputBefore)}%` : "none"],
        ["meter now", hero.pct != null ? `${Math.round(hero.pct)}%` : null],
        ["pays at", `${hero.cleanPct}%+ for a minute (meter proof, not the cleaner's word)`],
      ]}
    >
      {j && (
        <span className="flex flex-wrap gap-1.5 text-[11px]">
          <Proof kind="arc" id={j.openTx} label="Escrow" />
          <Proof kind="arc" id={j.releaseTx} label="Released" />
          <Proof kind="og" id={hero.og?.paid} />
        </span>
      )}
      {next && (
        <button type="button" className="btn-ghost self-start" onClick={next[1]}>
          {next[0]}
        </button>
      )}
    </Frame>
  );
}
