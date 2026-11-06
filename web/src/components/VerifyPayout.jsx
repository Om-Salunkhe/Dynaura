// Verify payout: anyone can recompute the meter proof of a paid job from Arkiv and check it
// against the proofHash the escrow stored on Arc, plus see the 0G request behind the job.
import { useState } from "react";
import { ARC_READY } from "../lib/arc.js";
import { ARKIV_READY } from "../lib/arkiv.js";
import { verifyPayout } from "../lib/verify.js";

const short = (h) => (h && h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h || "–");
const teeOk = (tee) => tee === true || (tee && typeof tee === "object" && Object.entries(tee).some(([k, v]) => /verif/i.test(k) && v === true));

export default function VerifyPayout({ hero }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const j = hero.job;
  if (hero.stage !== "paid" || !j) return null;
  const v = hero.verdict || {};

  if (!hero.live)
    return (
      <div className="flex flex-col gap-1 border-t border-line pt-3 text-[12px] text-muted">
        <span className="font-medium text-ink-2">Verify payout</span>
        Demo: there's no real proof to check. With the Pi live, this recomputes the meter proof from Arkiv and compares it with the hash on Arc.
      </div>
    );

  const canVerify = ARC_READY.escrow && ARKIV_READY && j.id != null && !!j.releaseTx;
  const run = async () => {
    setBusy(true);
    setRes(null);
    try {
      setRes(await verifyPayout({ id: j.id, proofMinutes: j.proofMinutes, releasedAt: j.releasedAt }));
    } catch (e) {
      setRes({ ok: false, why: e.shortMessage || e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-col">
          <span className="text-[13px] font-medium">Verify payout</span>
          <span className="text-[11.5px] text-muted">Recompute the meter proof from the signed readings on Arkiv and compare it with Arc.</span>
        </span>
        <button type="button" className="btn-ghost" disabled={busy || !canVerify} onClick={run}>
          {busy ? "Checking…" : "Verify"}
        </button>
      </div>
      {!canVerify && (
        <span className="text-[11.5px] text-muted">
          {!ARKIV_READY ? "Arkiv isn't set up in this app (VITE_ARKIV_OWNER)." : "This payout has no Arc release to check."}
        </span>
      )}
      {res && (
        <div className={`flex flex-col gap-1.5 rounded-[10px] border p-3 text-[12px] ${res.ok ? "border-good" : "border-bad"}`}>
          <span className={`text-[13px] font-medium ${res.ok ? "text-good" : "text-bad"}`}>
            {res.ok ? "✓ Matches: the proof on Arc is the hash of the signed readings on Arkiv" : `✗ ${res.why || "Doesn't match the proof on Arc"}`}
          </span>
          {res.rows?.length > 0 && (
            <span className="mono text-[11px] text-muted">
              {res.rows.length} signed panel minutes ({res.window}):{" "}
              {res.rows.map((r) => `${new Date(r.minute * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ${r.avgW.toFixed(3)} W`).join(" · ")}
            </span>
          )}
          {res.computed && <span className="mono text-[11px]">recomputed {short(res.computed)}</span>}
          {res.onChain && <span className="mono text-[11px]">on Arc {short(res.onChain)}</span>}
          <span className="mono text-[11px] text-ink-2">
            0G · req {short(res.ogRequestId || v.requestId)} {teeOk(v.tee) ? "· TEE ✓" : ""}
          </span>
        </div>
      )}
    </div>
  );
}
