import { useState } from "react";
import Icon from "../components/Icon.jsx";
import PageHeader from "../components/PageHeader.jsx";
import WalletButton from "../components/WalletButton.jsx";
import { ABI, ADDR, ARC_READY, ensureAllowance, errText, publicClient, txUrl, write } from "../lib/arc.js";
import { ARKIV_READY, fetchOffers, short, useArkiv } from "../lib/arkiv.js";

const DEMO = [{ key: "demo", day: "today", kwh: 1.2, price: 0.08, windowEnd: Math.floor(Date.now() / 1000) + 3 * 3600, requestId: "0x7f3a…c21e" }];

export default function ShopOffers() {
  const offers = useArkiv(fetchOffers, DEMO);
  const [bought, setBought] = useState({}); // offer key -> tx hash (or true in demo)
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const list = offers.live ? offers.data : DEMO;
  const onChain = offers.live && ARC_READY.shop;

  // Prepay on Arc: approve USDC once, then ShopTrade.placeOrder. The Pi settles after the window.
  const buy = async (o) => {
    if (!onChain) return setBought({ ...bought, [o.key]: true });
    setBusy(o.key);
    setErr(null);
    try {
      const wh = Math.round(o.kwh * 1000);
      const cost = await publicClient.readContract({ address: ADDR.shop, abi: ABI.shop, functionName: "costOf", args: [wh] });
      await ensureAllowance("shop", cost);
      const hash = await write("shop", "placeOrder", [o.day, wh, BigInt(o.windowEnd + 2 * 3600)]);
      setBought({ ...bought, [o.key]: hash });
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <PageHeader kicker="Corner grocery · Andheri East" title="Solar from next door" right={onChain ? <WalletButton /> : null} />

      <section className="card flex flex-col gap-1 rounded-[22px] text-sm">
        <span className="font-bold">Buy spare rooftop solar from Sunrise Apartments</span>
        <span className="text-xs text-muted">
          Offers live on Arkiv and disappear by themselves when the sun window closes. You pay in USDC on Arc, only for the
          kWh the meter delivers.
        </span>
        {!offers.live && <span className="text-xs text-muted">{ARKIV_READY ? "Arkiv not reachable · demo offer" : "Demo offer"}</span>}
      </section>

      {err && <section className="card text-sm text-bad">{err}</section>}

      {list.length === 0 && <section className="card text-sm text-muted">No spare solar right now. Check back at noon.</section>}

      {list.map((o) => {
        const ends = new Date(o.windowEnd * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        return (
          <section key={o.key} className="card flex flex-col gap-3 rounded-[26px]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-extrabold tracking-wider text-sun-ink">SPARE SOLAR · UNTIL {ends.toUpperCase()}</span>
              <span className="mono text-[11px] text-muted">{o.requestId?.startsWith("0x") && o.requestId.length > 12 ? short(o.requestId) : o.requestId}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-extrabold">{o.kwh} kWh</span>
              <span className="text-sm text-muted">{o.price.toFixed(2)} USDC / kWh</span>
            </div>
            <div className="inner flex items-center justify-between p-3 text-sm">
              <span className="flex items-center gap-2">
                <Icon name="lock" size={16} /> Prepay, refund what isn't delivered
              </span>
              <b>{(o.kwh * o.price).toFixed(2)} USDC</b>
            </div>
            <button type="button" className="btn min-h-[52px] text-[15px]" disabled={!!bought[o.key] || busy === o.key} onClick={() => buy(o)}>
              {busy === o.key ? "Confirm in your wallet…" : bought[o.key] ? (onChain ? "Prepaid on Arc" : "Reserved (demo)") : "Buy this solar"}
            </button>
            {typeof bought[o.key] === "string" && (
              <a className="text-center text-xs font-bold text-link" href={txUrl(bought[o.key])} target="_blank" rel="noreferrer">
                View on Arc · settled when the window closes, unused USDC comes back
              </a>
            )}
          </section>
        );
      })}
    </div>
  );
}
