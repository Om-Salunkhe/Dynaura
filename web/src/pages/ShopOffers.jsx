import { useEffect, useState } from "react";
import Icon from "../components/Icon.jsx";
import PageHeader from "../components/PageHeader.jsx";
import Proof from "../components/Proof.jsx";
import WalletButton from "../components/WalletButton.jsx";
import { ABI, ADDR, ARC_READY, ensureAllowance, errText, publicClient, txUrl, write } from "../lib/arc.js";
import { usePi } from "../lib/api.js";
import { fetchOffers, fetchTrades, useArkiv } from "../lib/arkiv.js";
import DemoSunBadge from "../components/DemoSunBadge.jsx";
import { TradeRow, soldTrades } from "../components/FairShare.jsx";

const normalize = (o) =>
  o && {
    key: `${o.request_id || "offer"}-${o.published_at || o.window_end}`,
    day: o.day,
    kwh: Number(o.kwh),
    price: Number(o.price_usdc),
    windowEnd: Number(o.window_end),
    requestId: o.request_id,
  };

export default function ShopOffers() {
  const market = usePi("/api/marketplace", null);
  const arkiv = useArkiv(() => fetchOffers(20), []);
  const recent = useArkiv(() => fetchTrades({ limit: 12 }), []);
  const pastTrades = soldTrades(recent.data).slice(0, 5);
  const [bought, setBought] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const offer = market.demo ? null : normalize(market.data?.offer);
  const orders = market.demo ? [] : market.data?.orders || [];
  const open = orders.filter((o) => o.status === "open");
  const arkivProof = offer && arkiv.data?.find((o) => o.requestId === offer.requestId && o.windowEnd === offer.windowEnd);
  const onChain = ARC_READY.shop;

  useEffect(() => {
    const timer = setInterval(market.reload, 4000);
    return () => clearInterval(timer);
  }, [market.reload]);

  const buy = async (o) => {
    if (!onChain) return setErr("ShopTrade is not configured on Arc.");
    if (Date.now() / 1000 >= o.windowEnd - 15) return setErr("This offer is closing. Wait for the next measured window.");
    setBusy(true);
    setErr(null);
    try {
      const wh = Math.round(o.kwh * 1000);
      const cost = await publicClient.readContract({ address: ADDR.shop, abi: ABI.shop, functionName: "costOf", args: [wh] });
      await ensureAllowance("shop", cost);
      const hash = await write("shop", "placeOrder", [o.day, wh, BigInt(o.windowEnd)]);
      setBought(hash);
      market.reload();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <PageHeader kicker="Corner grocery · Andheri East" title="Live solar marketplace" right={<WalletButton />} />

      <section className="card flex flex-col gap-1 rounded-[14px] text-sm">
        <span className="flex items-center gap-2 font-medium">Measured surplus from Sunrise Apartments <DemoSunBadge /></span>
        <span className="text-xs text-muted">
          The Pi publishes only surplus that 0G actually routed to the grid. A prepaid Arc order makes the next 0G window
          eligible for the shop; the contract refunds every Wh not delivered.
        </span>
        <span className={`mt-1 text-xs ${market.demo ? "text-bad" : "text-good"}`}>
          {market.loading ? "Connecting to the building…" : market.demo ? "Building Pi unreachable — no offer is being invented." : "Live from the building Pi"}
        </span>
      </section>

      {err && <section className="card text-sm text-bad">{err}</section>}

      {offer ? (
        <section className="card flex flex-col gap-3 rounded-[14px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium tracking-wider text-sun-ink">
              METERED OFFER · UNTIL {new Date(offer.windowEnd * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toUpperCase()}
            </span>
            {arkivProof && <Proof kind="arkiv" id={arkivProof.key} label="Offer" />}
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-3xl font-medium">{offer.kwh.toFixed(3)} kWh</span>
            <span className="text-sm text-muted">{offer.price.toFixed(2)} USDC / kWh</span>
          </div>
          <div className="inner flex items-center justify-between p-3 text-sm">
            <span className="flex items-center gap-2"><Icon name="lock" size={16} /> Prepay on Arc; undelivered energy is refunded</span>
            <b>{(offer.kwh * offer.price).toFixed(4)} USDC</b>
          </div>
          <button type="button" className="btn min-h-[52px] text-[15px]" disabled={busy || !!bought} onClick={() => buy(offer)}>
            {busy ? "Confirm in your wallet…" : bought ? "Prepaid on Arc" : "Buy this live offer"}
          </button>
          {bought && (
            <a className="text-center text-xs font-medium text-link" href={txUrl(bought)} target="_blank" rel="noreferrer">View prepaid order on Arc</a>
          )}
          {offer.requestId && <Proof kind="hash" id={offer.requestId} label="0G request" className="self-start text-[11px]" />}
        </section>
      ) : (
        <section className="card flex flex-col gap-1 rounded-[14px] text-sm">
          <span className="font-medium">No live offer right now</span>
          <span className="text-xs text-muted">
            {open.length ? "A prepaid order is being delivered. The next offer appears after it settles." : "The next offer appears after a real 0G trade measures spare solar going to the grid."}
          </span>
        </section>
      )}

      {market.demo && pastTrades.length > 0 && (
        <section className="card flex flex-col gap-1 rounded-[14px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[14px] font-medium">Recent 0G trades from the building</span>
            <span className="chip bg-inner text-muted">Read from Arkiv</span>
          </div>
          <span className="text-xs text-muted">Real decisions the Pi recorded while it was online. Live offers return when the building is reachable.</span>
          <div className="mt-1">
            {pastTrades.map((t) => (
              <TradeRow key={t.key || t.id} t={t} />
            ))}
          </div>
        </section>
      )}

      {open.map((o) => (
        <section key={o.order_id} className="card flex flex-col gap-2 rounded-[14px] text-sm">
          <span className="font-medium text-good">Arc order #{o.order_id} · delivery in progress</span>
          <span className="text-xs text-muted">
            {(Number(o.want_wh) / 1000).toFixed(3)} kWh prepaid · settles {new Date(Number(o.deadline) * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </span>
          <span className="text-xs text-muted">0G can now route measured spare to this order. Any shortfall returns to the buyer automatically.</span>
        </section>
      ))}
    </div>
  );
}
