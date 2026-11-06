// Bill page: "Your share of the sun". Share vs used vs unused, what the spare earned against an
// equal split, the trades that sold it (with their 0G request ids), and Claim on Arc.
import { useState } from "react";
import { ARC_READY, errText, write } from "../lib/arc.js";
import { flatName, units, usdc, useCredits } from "../lib/credits.js";
import { isFakeId } from "../lib/scene.js";
import Proof from "./Proof.jsx";

const shortId = (id) => (id && id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id || "");
const time = (t) => new Date(t * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
// trader.py sends window as ["12:00", "12:15"]; the demo as one string
const windowText = (w) => (Array.isArray(w) ? w.join("–") : w);
/** Trades that actually sold something (trader.py logs "none" when there's no spare). */
export const soldTrades = (trades) => (trades || []).filter((t) => t.mode !== "none" && (t.routes || []).some((r) => r.wh > 0));

function Bar({ label, wh, max, tone, note }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-[12.5px]">
        <span className="text-muted">{label}</span>
        <span className="font-medium">
          {units(wh)}
          {note ? <span className="text-muted"> · {note}</span> : null}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-inner">
        <span className={`block h-full rounded-full ${tone}`} style={{ width: `${max ? Math.min(100, (wh / max) * 100) : 0}%` }} />
      </div>
    </div>
  );
}

/** One 0G trade: where the spare went, at what price, and why. */
export function TradeRow({ t }) {
  return (
    <div className="flex flex-col gap-1 border-t border-line py-2.5 first-of-type:border-0">
      <span className="text-[11px] text-muted">
        {windowText(t.window) || (t.at ? time(t.at) : "")} · {t.mode === "ai" ? "decided on 0G" : "no-ai: 0G unreachable, spare to the grid"}
      </span>
      <span className="text-[13px]">
        {t.routes
          .filter((r) => r.wh > 0)
          .map((r) => `${units(r.wh)} → ${flatName(r.to)} at ${r.price}`)
          .join(" · ")}
      </span>
      {t.reason && <span className="text-[12px] text-ink-2">“{t.reason}”</span>}
      {t.mode === "ai" && t.request_id && (
        <span className="mono text-[11px] text-muted" title={t.request_id}>
          0G · req {isFakeId(t.request_id) ? "demo" : shortId(t.request_id)}
        </span>
      )}
    </div>
  );
}

export default function FairShare({ flat }) {
  const [period, setPeriod] = useState("today");
  const c = useCredits(period);
  const [claimed, setClaimed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  if (c.status === "off" || c.status === "loading" || !c.data) {
    return c.status === "error" ? (
      <section className="card rounded-[14px] text-[12.5px] text-muted">Your share of the sun: the Pi didn't answer ({c.error}).</section>
    ) : null;
  }
  const d = c.data;
  const me = d.flats?.[flat];
  if (!me) return null;
  const max = Math.max(me.share_wh, me.used_wh, 1);
  const trades = soldTrades(d.trades).slice(-3).reverse();
  const chain = d.chain || {};
  const claimTx = claimed || chain.claims?.[flat] || null;
  const canClaim = me.earned_usdc > 0 && !claimTx && (c.demo || (chain.period_id && ARC_READY.credits));

  const claim = async () => {
    setErr(null);
    if (c.demo) return setClaimed("0xdemo-claim");
    setBusy(true);
    try {
      setClaimed(await write("credits", "claim", [chain.period_id, flat]));
      c.reload();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card flex flex-col gap-3 rounded-[14px]">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="text-base font-medium">Your share of the sun</span>
          {c.demo && <span className="chip bg-inner text-muted">Demo</span>}
        </span>
        {!c.demo && (
          <span role="tablist" className="flex rounded-[9px] border border-line p-0.5 text-[12px]">
            {["today", "month"].map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={period === p}
                onClick={() => setPeriod(p)}
                className={`rounded-[7px] px-2.5 py-1 ${period === p ? "bg-inner font-medium text-ink" : "text-muted"}`}
              >
                {p === "today" ? "Today" : "Month"}
              </button>
            ))}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        <Bar label="Your fair share" wh={me.share_wh} max={max} tone="bg-ink-2" />
        <Bar label="You used" wh={me.used_wh} max={max} tone="bg-sun" />
        {me.over_wh > 0 ? (
          <Bar label="Over your share" wh={me.over_wh} max={max} tone="bg-grid" note="bought from neighbours" />
        ) : (
          <Bar label="You left unused" wh={me.unused_wh} max={max} tone="bg-good" />
        )}
      </div>

      <p className="m-0 text-[14px] leading-relaxed">
        {me.unused_wh > 0 ? (
          <>
            Your spare {units(me.unused_wh)} earned <span className="font-medium text-good">{usdc(me.earned_usdc)}</span>. An equal split would give{" "}
            {usdc(me.equal_split_usdc)}.
          </>
        ) : me.over_wh > 0 ? (
          <>
            You used {units(me.over_wh)} more than your share. You pay your neighbours <span className="font-medium">{usdc(me.owes_usdc)}</span> for them, at{" "}
            {d.pool?.prices?.neighbor} a unit.
          </>
        ) : (
          "You used exactly your share: nothing to sell, nothing to buy."
        )}
      </p>
      <span className="text-[11.5px] text-muted">
        Units are kWh. Each flat is paid for the share it left unused ({units(d.spare_wh)} spare in the building), not an equal split.
      </span>

      {trades.length > 0 && (
        <div className="flex flex-col">
          <span className="text-[12px] font-medium text-ink-2">Where the spare was sold</span>
          {trades.map((t, i) => (
            <TradeRow key={`${t.at}-${i}`} t={t} />
          ))}
        </div>
      )}

      {me.earned_usdc > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-line pt-3">
          {claimTx ? (
            <Proof kind="arc" id={claimTx} label="Claimed on Arc" className="self-start text-xs" />
          ) : (
            <button type="button" className="btn self-start" disabled={busy || !canClaim} onClick={claim}>
              {busy ? "Confirm in your wallet…" : `Claim ${usdc(me.earned_usdc)} on Arc`}
            </button>
          )}
          {!claimTx && !c.demo && !chain.period_id && <span className="text-[11.5px] text-muted">Not settled on Arc yet: the committee settles the period, then you can claim.</span>}
          {!claimTx && !c.demo && chain.period_id && !ARC_READY.credits && <span className="text-[11.5px] text-muted">SolarCredits isn't set in this app yet (VITE_ARC_CREDITS).</span>}
          {c.demo && !claimTx && <span className="text-[11.5px] text-muted">Demo: the claim is simulated. Live, SolarCredits pays this from the pool on Arc, computed on chain.</span>}
          {err && <span className="text-[12px] text-bad">{err}</span>}
        </div>
      )}
    </section>
  );
}
