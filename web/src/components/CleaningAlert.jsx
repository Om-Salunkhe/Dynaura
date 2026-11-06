// Admin notification for a flagged panel (cleaning flow v3): the 0G evidence (the frame the Pi
// looked at, the verdict and coverage, the reason, the request id, TEE) and the committee's choice.
// No money moves until the committee approves; Dismiss closes the request as rejected.
import { useState } from "react";
import { useLive } from "../lib/api.js";
import { frameUrl } from "../lib/cleaningApi.js";
import { useHero } from "../lib/hero.js";
import { isFakeId } from "../lib/scene.js";

const shortId = (id) => (id && id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id || "");
const teeOk = (tee) => tee === true || (tee && typeof tee === "object" && Object.entries(tee).some(([k, v]) => /verif/i.test(k) && v === true));

export function DemoFrame() {
  // a neutral stand-in: the demo has no camera, so no fake photo either
  return (
    <div className="grid aspect-[4/3] w-full place-items-center rounded-[10px] border border-dashed border-line bg-inner text-center text-[11.5px] text-muted">
      <span>
        Demo: no camera frame
        <br />
        (the Pi sends a JPEG)
      </span>
    </div>
  );
}

export default function CleaningAlert() {
  const live = useLive();
  const hero = useHero(live);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  if (hero.stage !== "flagged") return null;
  const v = hero.verdict || {};
  const fee = hero.fee ?? 2;
  const demo = !hero.live;

  const act = async (which, fn) => {
    setBusy(which);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section role="alert" className="card mb-4 grid gap-4 border-[rgba(240,140,90,0.45)] p-4 sm:grid-cols-[200px_1fr]">
      <div className="flex flex-col gap-1.5">
        {demo ? (
          <DemoFrame />
        ) : (
          <img
            src={frameUrl(v, hero.updatedAt)}
            alt="The panel, as the Pi's camera saw it for the 0G check"
            className="aspect-[4/3] w-full rounded-[10px] border border-line object-cover"
          />
        )}
        <span className="text-[11px] text-muted">{v.input === "meter-only" ? "No vision model: judged from the meter and the forecast" : "Frame the 0G vision check looked at"}</span>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-bad" />
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-bad">Cleaning request · needs approval</span>
          {demo && <span className="chip bg-inner text-muted">Demo</span>}
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[17px] font-medium">
            0G says the panel is {v.dirty === false ? "clean" : "dirty"}
            {v.coverage != null ? ` · about ${Math.round(v.coverage)}% covered` : ""}
          </span>
          {v.reason && <span className="text-[13px] text-ink-2">“{v.reason}”</span>}
          <span className="text-[12.5px] text-muted">
            Output at {hero.dustyPct != null ? `${Math.round(hero.dustyPct)}%` : "–"} of expected. Nothing is paid until you approve; the cleaner is paid only if the meter proves it clean.
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11.5px]">
          <span className="mono rounded-[6px] border border-line px-2 py-0.5 text-ink-2" title={v.requestId}>
            0G · req {isFakeId(v.requestId) ? "demo" : shortId(v.requestId) || "–"} {teeOk(v.tee) ? "· TEE ✓" : ""}
          </span>
          {v.input && <span className="mono rounded-[6px] border border-line px-2 py-0.5 text-muted">{v.input}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn" disabled={!!busy} onClick={() => act("approve", () => hero.actions.approve?.(fee))}>
            {busy === "approve" ? "Opening the escrow on Arc…" : `Approve cleaning · ${Number(fee).toFixed(0)} USDC`}
          </button>
          <button type="button" className="btn-ghost" disabled={!!busy} onClick={() => act("reject", () => hero.actions.reject?.())}>
            {busy === "reject" ? "Dismissing…" : "Dismiss"}
          </button>
          {err && <span className="text-[12px] text-bad">{err}</span>}
        </div>
      </div>
    </section>
  );
}
