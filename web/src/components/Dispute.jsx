// Disputes (cleaning flow v3). The cleaner can dispute an accepted job before its deadline
// (CleaningEscrow.dispute); only the committee wallet (the escrow's owner, not the Pi) can
// resolve it (CleaningEscrow.resolve): pay the cleaner or refund the society.
import { useEffect, useState } from "react";
import { ABI, ADDR, ARC_READY, connect, errText, publicClient, short, txUrl, useWallet, write } from "../lib/arc.js";

const left = (deadline) => (deadline ? deadline - Date.now() : null);
const mins = (ms) => Math.max(0, Math.round(ms / 60000));

/** Cleaner: dispute an accepted (or marked-done) job that hasn't paid out yet. */
export function DisputeButton({ hero }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("Cleaned, but the job hasn't paid out");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [tx, setTx] = useState(null);
  const j = hero.job;
  if (!j || !["accepted", "cleaning"].includes(hero.stage)) return null;
  const ms = left(j.deadline);
  if (ms != null && ms <= 0) return <span className="text-[12px] text-muted">Past the deadline: the escrow can no longer be disputed, only refunded.</span>;
  const soon = ms != null && ms < 20 * 60 * 1000;
  const onChain = hero.live && ARC_READY.escrow && j.id != null;

  const send = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (!hero.live) hero.actions.dispute?.();
      else setTx(await write("escrow", "dispute", [BigInt(j.id), reason.slice(0, 256)]));
      setOpen(false);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      {!open ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={`text-[12.5px] ${soon ? "text-bad" : "text-muted"}`}>
            {soon ? `${mins(ms)} min left and not paid yet?` : "Done the work but not paid?"} You can dispute it{ms != null ? ` until ${new Date(j.deadline).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}.
          </span>
          <button type="button" className={soon ? "btn" : "btn-ghost"} onClick={() => setOpen(true)} disabled={hero.live && !onChain}>
            Dispute
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-[12px] text-muted">
            Why (goes on Arc with the dispute, max 256 characters)
            <input className="rounded-[9px] border border-line bg-transparent px-3 py-2 text-[13.5px] text-ink outline-none" value={reason} maxLength={256} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <button type="button" className="btn" disabled={busy || !reason.trim()} onClick={send}>
              {busy ? "Confirm in your wallet…" : "Send dispute on Arc"}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
          <span className="text-[11.5px] text-muted">The committee then decides: pay you or refund the society.</span>
        </div>
      )}
      {hero.live && !onChain && <span className="text-[11.5px] text-muted">This job has no Arc escrow id yet.</span>}
      {tx && (
        <a className="text-[12px] text-link" href={txUrl(tx)} target="_blank" rel="noreferrer">
          Disputed on Arc · view tx
        </a>
      )}
      {err && <span className="text-[12px] text-bad">{err}</span>}
    </div>
  );
}

/** Committee: resolve a disputed job with the committee wallet (the escrow owner). */
export function ResolveDispute({ hero }) {
  const w = useWallet();
  const [owner, setOwner] = useState(null);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [tx, setTx] = useState(null);
  const j = hero.job;
  const live = hero.live && ARC_READY.escrow;

  useEffect(() => {
    if (!live) return;
    publicClient
      .readContract({ address: ADDR.escrow, abi: ABI.escrow, functionName: "owner" })
      .then(setOwner)
      .catch(() => {});
  }, [live]);

  if (hero.stage !== "disputed" || !j) return null;
  const isCommittee = !live || (owner && w.address && owner.toLowerCase() === w.address.toLowerCase());

  const resolve = async (pay) => {
    setBusy(pay ? "pay" : "refund");
    setErr(null);
    try {
      if (!hero.live) hero.actions.resolve?.(pay);
      else setTx(await write("escrow", "resolve", [BigInt(j.id), pay]));
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card flex flex-col gap-3 rounded-[14px] border-[rgba(240,140,90,0.45)]">
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-bad">Dispute · committee decides</span>
        <span className="text-[15px] font-medium">
          The cleaner disputed job #{j.id}. {Number(j.fee).toFixed(2)} USDC stays locked until the committee decides.
        </span>
        <span className="text-[12.5px] text-muted">Signed by the committee wallet in your browser wallet; the Pi can't decide this.</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn" disabled={!!busy || !isCommittee} onClick={() => resolve(true)}>
          {busy === "pay" ? "Confirm in your wallet…" : "Pay the cleaner"}
        </button>
        <button type="button" className="btn-ghost" disabled={!!busy || !isCommittee} onClick={() => resolve(false)}>
          {busy === "refund" ? "Confirm in your wallet…" : "Refund the society"}
        </button>
      </div>
      {live && !w.address && (
        <button type="button" className="btn-ghost self-start" onClick={connect} disabled={w.busy}>
          {w.busy ? "Connecting…" : "Connect the committee wallet"}
        </button>
      )}
      {live && w.address && owner && !isCommittee && (
        <span className="text-[12px] text-bad">
          This wallet ({short(w.address)}) isn't the committee. The escrow owner is {short(owner)}.
        </span>
      )}
      {tx && (
        <a className="text-[12px] text-link" href={txUrl(tx)} target="_blank" rel="noreferrer">
          Resolved on Arc · view tx
        </a>
      )}
      {err && <span className="text-[12px] text-bad">{err}</span>}
    </section>
  );
}
