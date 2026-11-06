// Admin: the fair split for today (each flat's spare, what it earned, what an equal split would
// give) and "Settle credits", which posts the period to Arc (SolarCredits) via the Pi.
import { useState } from "react";
import { periodFlats, settleCredits, units, usdc, useCredits } from "../lib/credits.js";
import Proof from "./Proof.jsx";

export default function SettleCredits() {
  const c = useCredits("today");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [demoChain, setDemoChain] = useState(null);
  if (c.status === "off" || c.status === "loading" || !c.data) return null;
  const d = c.data;
  const chain = (c.demo ? demoChain : d.chain) || {};

  const settle = async () => {
    setErr(null);
    if (c.demo) return setDemoChain({ period_id: "0xdemo-period", post_tx: "0xdemo-post", fund_tx: "0xdemo-fund" });
    setBusy(true);
    try {
      await settleCredits("today");
      c.reload();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card flex flex-col gap-3 rounded-[14px]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="text-base font-medium">Fair share · today</span>
          {c.demo && <span className="chip bg-inner text-muted">Demo</span>}
        </span>
        <span className="text-[12px] text-muted">
          {units(d.spare_wh)} spare sold for {usdc(d.pool?.revenue_usdc)}
        </span>
      </div>
      <div className="grid grid-cols-[auto_1fr_auto_auto] items-baseline gap-x-4 gap-y-1.5 text-[13px]">
        <span className="text-[11px] text-muted">Flat</span>
        <span className="text-[11px] text-muted">Left unused</span>
        <span className="text-right text-[11px] text-muted">Earns</span>
        <span className="text-right text-[11px] text-muted">Equal split</span>
        {periodFlats(d).map((f) => {
          const x = d.flats?.[f] || {};
          return (
            <div key={f} className="contents">
              <span className="font-medium">{f}</span>
              <span className="text-ink-2">{x.over_wh > 0 ? `over by ${units(x.over_wh)}` : units(x.unused_wh || 0)}</span>
              <span className="text-right font-medium">{usdc(x.earned_usdc)}</span>
              <span className="text-right text-muted">{usdc(x.equal_split_usdc)}</span>
            </div>
          );
        })}
      </div>
      <span className="text-[11.5px] text-muted">Paid by the share each flat left unused. SolarCredits on Arc computes each payout on chain.</span>
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        {chain.post_tx ? (
          <>
            <Proof kind="arc" id={chain.post_tx} label="Posted on Arc" className="text-xs" />
            {chain.fund_tx && <Proof kind="arc" id={chain.fund_tx} label="Funded" className="text-xs" />}
          </>
        ) : (
          <button type="button" className="btn" disabled={busy || !(d.spare_wh > 0)} onClick={settle}>
            {busy ? "Settling on Arc…" : "Settle credits"}
          </button>
        )}
        {err && <span className="text-[12px] text-bad">{err}</span>}
      </div>
    </section>
  );
}
