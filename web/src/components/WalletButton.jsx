import { connect, short, useWallet } from "../lib/arc.js";

/** "Connect wallet" → "0x12ab…9f3c on Arc" */
export default function WalletButton({ className = "" }) {
  const w = useWallet();
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {w.address ? (
        <span className="chip w-fit bg-inner py-1 text-xs">
          <span className="h-2 w-2 rounded-full bg-sun" /> {short(w.address)} · Arc testnet
        </span>
      ) : (
        <button type="button" className="chip w-fit border border-line bg-card-solid py-1.5 text-xs font-bold" onClick={connect} disabled={w.busy}>
          {w.busy ? "Connecting…" : "Connect wallet"}
        </button>
      )}
      {w.error && <span className="text-xs text-bad">{w.error}</span>}
    </div>
  );
}
