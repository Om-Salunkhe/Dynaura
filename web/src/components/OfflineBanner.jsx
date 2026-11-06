import Icon from "./Icon.jsx";

/** Is Dyna (0G) unreachable? The Pi's runner is in no-AI mode (the demo scene sets the same flag). */
export const isOffline = (live) => live.runner?.mode === "no-ai";

/** The Pi stopped switching (e.g. a meter read failed): everything is on grid until it recovers. */
export function SafeStopBanner({ live }) {
  if (live.runner?.mode !== "safe-stop") return null;
  return (
    <section role="alert" className="mb-3 flex flex-col gap-1 rounded-[14px] border-2 border-grid bg-[rgba(110,155,255,0.12)] p-4 text-sm">
      <span className="text-[11px] font-medium tracking-wider text-link">SAFE STOP</span>
      <span className="font-medium">The Pi stopped switching{live.safe_stop?.reason ? ` (${live.safe_stop.reason})` : ""}. Every flat is on grid until it recovers.</span>
    </section>
  );
}

/** The honesty state: what the building does when 0G can't be reached. */
export default function OfflineBanner({ size = "md" }) {
  if (size === "strip") {
    // one line, for the projector's other moments
    return (
      <section role="status" className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-full border-2 border-bad bg-[rgba(180,35,24,0.10)] px-6 py-3 text-xl">
        <span className="font-medium tracking-wider text-bad">0G OFFLINE</span>
        <span className="font-medium">Flats on grid · pump on a timer · no AI decisions</span>
      </section>
    );
  }
  const xl = size === "xl";
  const facts = [
    ["Flats on grid", "bg-grid"],
    ["Pump on a timer", "bg-grid"],
    ["No AI decisions", "bg-bad"],
  ];
  return (
    <section
      role="status"
      className={`flex flex-col border-2 border-bad bg-[rgba(180,35,24,0.10)] ${xl ? "gap-6 rounded-[36px] p-10" : "mb-3 gap-2 rounded-[14px] p-4"}`}
    >
      <span className="flex items-center gap-3">
        <span className={`grid flex-none place-items-center rounded-full bg-bad text-white ${xl ? "h-16 w-16" : "h-9 w-9"}`}>
          <Icon name="spark" size={xl ? 32 : 18} />
        </span>
        <span className="flex flex-col">
          <span className={`font-medium tracking-wider text-bad ${xl ? "text-2xl" : "text-[11px]"}`}>0G OFFLINE</span>
          <span className={`font-medium ${xl ? "text-5xl" : "text-[15px]"}`}>Dyna can't be reached, so nothing is guessed.</span>
        </span>
      </span>
      <span className={`flex flex-wrap ${xl ? "gap-4" : "gap-2"}`}>
        {facts.map(([t, dot]) => (
          <span key={t} className={`chip bg-card-solid ${xl ? "px-6 py-3 text-2xl" : "py-1 text-xs"}`}>
            <span className={`rounded-full ${dot} ${xl ? "h-4 w-4" : "h-2 w-2"}`} />
            {t}
          </span>
        ))}
      </span>
      <span className={`text-muted ${xl ? "text-2xl" : "text-xs"}`}>
        The building runs on safe defaults. When 0G is back, Dyna plans again and the queued proofs upload.
      </span>
    </section>
  );
}
