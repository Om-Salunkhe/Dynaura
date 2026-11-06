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
  const refunded = hero.stage === "refunded" || j?.resolution === "refunded";
  const disputed = hero.stage === "disputed";
  const resolved = hero.stage === "resolved";

  const steps = [
    {
      at: 1,
      title: "Output drops",
      text: pct != null && i >= 1 ? `Panel at ${j?.outputBefore != null ? Math.round(j.outputBefore) : pct}% of a clean panel` : `Alert under ${hero.dustPct}%`,
    },
    {
      at: 2,
      title: "0G looks → committee approves",
      text:
        hero.stage === "flagged"
          ? `0G says dirty${hero.verdict?.coverage != null ? ` (~${Math.round(hero.verdict.coverage)}% covered)` : ""} · waiting for approval`
          : j?.openTx
            ? `Approved · ${j.fee.toFixed(2)} USDC locked on Arc`
            : i === 1
              ? "The meter dropped, so the Pi asks 0G to look"
              : "No money moves before the committee approves",
      proofs: j && [
        ["arc", j.openTx, "Arc tx"],
        ["og", hero.og?.open, "0G proof"],
        ["ogtx", hero.og?.openTx, "0G registry"],
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
          : disputed || resolved
            ? "Not reached: the cleaner disputed"
            : i === 4 && pct != null
            ? `Now ${pct}% · checking (needs +${hero.minGain ?? 15} over the dusty level too)`
            : i === 3
              ? "The cleaner taps done; the meter decides"
              : "The paper comes off",
    },
    {
      at: 5,
      title: disputed
        ? "Disputed: the committee decides"
        : resolved
          ? `Resolved: ${j?.resolution === "refunded" ? "refunded to the society" : j?.resolution === "paid" ? "paid to the cleaner" : "decided by the committee"}`
          : refunded
            ? "Refunded to the society"
            : "USDC released, automatically",
      text: disputed
        ? "The committee wallet pays the cleaner or refunds; the Pi can't"
        : resolved
          ? "Decided by the committee wallet, not the Pi"
          : refunded
        ? "Nobody cleaned before the deadline"
        : j?.outputAfter != null
          ? `Back at ${Math.round(j.outputAfter)}% · paid on meter proof, not anyone's word`
          : "Paid on meter proof, not anyone's word",
      proofs: (j?.releaseTx || j?.refundTx) && [
        ["arc", j.releaseTx || j.refundTx, "Arc tx"],
        ["og", hero.og?.paid, "0G proof"],
        ["ogtx", hero.og?.paidTx, "0G registry"],
      ],
    },
  ];

  // a dispute skips the meter step: the committee decides step 5
  const firstOpen = disputed ? 5 : [1, 2, 3, 4, 5].find((k) => i < (k === 4 ? 5 : k));
  const xl = size === "xl";
  return (
    <ol className={`flex flex-col ${xl ? "gap-3 2xl:gap-5 [@media(max-height:820px)]:gap-2" : "gap-3"}`}>
      {steps.map((s) => {
        // step 4 (meter at 90%+) is only done once the release went through
        const done = s.at === 4 && (disputed || resolved) ? false : i >= (s.at === 4 ? 5 : s.at);
        const active = !done && i >= 1 && s.at === firstOpen;
        return (
          <li key={s.at} className={`flex items-start ${xl ? "gap-4 2xl:gap-5" : "gap-3"} ${!done && !active ? "opacity-40" : ""}`}>
            <span
              className={`grid flex-none place-items-center rounded-full font-medium ${xl ? "h-11 w-11 text-xl 2xl:h-14 2xl:w-14 2xl:text-2xl" : "h-8 w-8 text-sm"} ${
                done ? (refunded && s.at === 5 ? "bg-bad text-white" : "bg-good text-white") : active ? "animate-pulse bg-sun text-[#111418]" : "bg-inner text-muted"
              }`}
            >
              {done ? <Icon name="check" size={xl ? 28 : 16} /> : s.at}
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              <span className={`font-medium ${xl ? "text-2xl 2xl:text-3xl" : "text-[15px]"}`}>{s.title}</span>
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
