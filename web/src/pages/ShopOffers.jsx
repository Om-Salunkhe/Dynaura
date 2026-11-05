import { useState } from "react";
import Icon from "../components/Icon.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { ARKIV_READY, fetchOffers, short, useArkiv } from "../lib/arkiv.js";

const DEMO = [{ key: "demo", day: "today", kwh: 1.2, price: 0.08, windowEnd: Math.floor(Date.now() / 1000) + 3 * 3600, requestId: "0x7f3a…c21e" }];

export default function ShopOffers() {
  const offers = useArkiv(fetchOffers, DEMO);
  const [bought, setBought] = useState({});
  const list = offers.live ? offers.data : DEMO;

  return (
    <div className="flex flex-col gap-3">
      <PageHeader kicker="Corner grocery · Andheri East" title="Solar from next door" />

      <section className="card flex flex-col gap-1 rounded-[22px] text-sm">
        <span className="font-bold">Buy spare rooftop solar from Sunrise Apartments</span>
        <span className="text-xs text-muted">
          Offers live on Arkiv and disappear by themselves when the sun window closes. You pay in USDC on Arc, only for the
          kWh the meter delivers.
        </span>
        {!offers.live && <span className="text-xs text-muted">{ARKIV_READY ? "Arkiv not reachable · demo offer" : "Demo offer"}</span>}
      </section>

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
            <button type="button" className="btn min-h-[52px] text-[15px]" disabled={bought[o.key]} onClick={() => setBought({ ...bought, [o.key]: true })}>
              {bought[o.key] ? "Reserved (pay on Arc next)" : "Buy this solar"}
            </button>
          </section>
        );
      })}
    </div>
  );
}
