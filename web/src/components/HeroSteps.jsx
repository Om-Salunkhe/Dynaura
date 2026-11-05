import { stageIndex } from "../lib/hero.js";
import Icon from "./Icon.jsx";
import Proof from "./Proof.jsx";

/**
 * The cleaning hero moment as 5 steps, from dust to USDC.
 * size "md" for app screens, "xl" for the projector.
 */
export default function HeroSteps({ hero, size = "md" }) {
  const i = stageIndex(hero.stage);
  const j = hero.job;
  const pct = hero.pct != null ? Math.round(hero.pct) : null;
  const refunded = hero.stage === "refunded";

  const steps = [
    {
      at: 1,
      title: "Output drops",
      text: pct != null && i >= 1 ? `Panel at ${j?.outputBefore != null ? Math.round(j.outputBefore) : pct}% of a clean panel` : `Alert under ${hero.dustPct}%`,
    },
    {
      at: 2,
      title: "panel_dirty → escrow opens",
      text: j ? `${j.fee.toFixed(2)} USDC locked on Arc` : i === 1 && !hero.flagged ? "Checking for a minute first…" : "Dyna flags it, the Pi locks the fee",
      proofs: j && [
        ["arc", j.openTx, "Arc tx"],
        ["og", hero.og?.open, "0G proof"],
      ],
    },
    {
      at: 3,
      title: "Cleaner accepts",
      text: j?.cleaner ? `${j.cleaner.startsWith?.("0x") ? `${j.cleaner.slice(0, 6)}…` : j.cleaner} took the job` : "From their own wallet",
      proofs: j?.acceptTx && [["arc", j.acceptTx, "Arc tx"]],
    },
    {
      at: 4,
      title: `Meter sees ${hero.cleanPct}%+`,
      text:
        i >= 5 && !refunded
          ? `Held above ${hero.cleanPct}%, checked on the signed meter readings`
          : i === 4 && pct != null
            ? `Now ${pct}% · checking`
            : i === 3
              ? "Waiting for the paper to come off"
              : "The paper comes off",
    },
    {
      at: 5,
      title: refunded ? "Refunded to the society" : "USDC released, automatically",
      text: refunded ? "Nobody cleaned before the deadline" : j?.outputAfter != null ? `Back at ${Math.round(j.outputAfter)}% · no one pressed approve` : "No one presses approve",
      proofs: (j?.releaseTx || j?.refundTx) && [
        ["arc", j.releaseTx || j.refundTx, "Arc tx"],
        ["og", hero.og?.paid, "0G proof"],
      ],
    },
  ];

  const firstOpen = [1, 2, 3, 4, 5].find((k) => i < (k === 4 ? 5 : k));
  const xl = size === "xl";
  return (
    <ol className={`flex flex-col ${xl ? "gap-3 2xl:gap-5 [@media(max-height:820px)]:gap-2" : "gap-3"}`}>
      {steps.map((s) => {
        // step 4 (meter at 90%+) is only done once the release went through
        const done = i >= (s.at === 4 ? 5 : s.at);
        const active = !done && i >= 1 && s.at === firstOpen;
        return (
          <li key={s.at} className={`flex items-start ${xl ? "gap-4 2xl:gap-5" : "gap-3"} ${!done && !active ? "opacity-40" : ""}`}>
            <span
              className={`grid flex-none place-items-center rounded-full font-extrabold ${xl ? "h-11 w-11 text-xl 2xl:h-14 2xl:w-14 2xl:text-2xl" : "h-8 w-8 text-sm"} ${
                done ? (refunded && s.at === 5 ? "bg-bad text-white" : "bg-good text-white") : active ? "animate-pulse bg-sun text-[#111418]" : "bg-inner text-muted"
              }`}
            >
              {done ? <Icon name="check" size={xl ? 28 : 16} /> : s.at}
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              <span className={`font-extrabold ${xl ? "text-2xl 2xl:text-3xl" : "text-[15px]"}`}>{s.title}</span>
              <span className={`text-muted ${xl ? "text-lg 2xl:text-xl [@media(max-height:820px)]:hidden" : "text-xs"}`}>{s.text}</span>
              {s.proofs && (done || active) && (
                <span className={`flex flex-wrap gap-2 ${xl ? "pt-1 text-base 2xl:text-lg" : "text-[11px]"}`}>
                  {s.proofs.map(([kind, id, label]) => (
                    <Proof key={label} kind={kind} id={id} label={label} />
                  ))}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
