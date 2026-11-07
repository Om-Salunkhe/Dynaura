import { useEffect, useMemo, useState } from "react";
import PageHeader from "../components/PageHeader.jsx";
import Proof from "../components/Proof.jsx";
import { postJSON, usePi } from "../lib/api.js";
import { fetchMaintenance, fetchSales, short, useArkiv } from "../lib/arkiv.js";

export default function AdminTrading() {
  const market = usePi("/api/marketplace", null);
  const [price, setPrice] = useState(0.08);
  const [editing, setEditing] = useState(false);
  const fromArkiv = useArkiv(() => fetchMaintenance(20), null);
  const archivedSales = useArkiv(() => fetchSales({ limit: 10 }), []);
  const [records, setRecords] = useState([]);
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ title: "", text: "" });
  const orders = market.demo ? [] : market.data?.orders || [];
  const offer = market.demo ? null : market.data?.offer;
  const sales = useMemo(() => {
    const byOrder = new Map();
    for (const s of archivedSales.data || []) byOrder.set(s.orderId, s);
    for (const s of market.demo ? [] : market.data?.sales || []) {
      const proof = byOrder.get(s.order_id);
      byOrder.set(s.order_id, {
        ...proof,
        orderId: s.order_id,
        buyer: s.buyer,
        kwh: Number(s.kwh),
        usdc: Number(s.usdc),
        refunded: Number(s.refunded),
        arcTx: s.arc_tx,
      });
    }
    return [...byOrder.values()].sort((a, b) => b.orderId - a.orderId);
  }, [archivedSales.data, market.data, market.demo]);

  useEffect(() => {
    const timer = setInterval(market.reload, 4000);
    return () => clearInterval(timer);
  }, [market.reload]);
  useEffect(() => {
    if (!market.demo && market.data?.price_usdc != null) setPrice(Number(market.data.price_usdc));
  }, [market.data?.price_usdc, market.demo]);
  useEffect(() => {
    if (fromArkiv.live)
      setRecords(fromArkiv.data.map((m) => ({ date: m.date, title: m.title, text: m.text, arcTx: m.arcTx, key: m.key })));
  }, [fromArkiv]);

  const savePrice = () => {
    setEditing(false);
    postJSON("/api/admin/price", { price_usdc: price }, { admin: true })
      .then((r) => {
        setNote(`Arc price updated${r.arc_tx ? ` · ${short(r.arc_tx)}` : ""}`);
        market.reload();
      })
      .catch((e) => setNote(e.message));
  };

  const addRecord = (e) => {
    e.preventDefault();
    if (!draft.title.trim()) return;
    const date = new Date().toISOString().slice(0, 10);
    const rec = { title: draft.title.trim(), details: draft.text.trim() || "Added by admin" };
    postJSON("/api/admin/maintenance", rec, { admin: true })
      .then((r) => {
        setNote(`Saved on Arkiv · ${short(r.key)}`);
        setRecords((rows) => [{ date, title: rec.title, text: rec.details, key: r.key }, ...rows]);
        setDraft({ title: "", text: "" });
        setAdding(false);
      })
      .catch((error) => setNote(error.message || "Maintenance record was not saved"));
  };

  return (
    <div className="flex flex-col gap-3">
      <PageHeader kicker="Admin · Sunrise Apartments" title="Live energy market" />

      <section className="card flex flex-col gap-2.5 rounded-[14px]">
        <div className="flex items-center justify-between gap-2">
          <span className="flex flex-col gap-0.5">
            <span className="text-base font-medium">Selling measured spare solar</span>
            <span className="text-xs text-muted">0G routes it; shops prepay and settle in USDC on Arc</span>
          </span>
          {editing ? (
            <label className="chip bg-sun-soft text-sun-ink">
              <input type="number" step="0.01" min="0" className="w-14 bg-transparent text-right font-medium outline-none" value={price} onChange={(e) => setPrice(Number(e.target.value))} onBlur={savePrice} autoFocus />
              / kWh
            </label>
          ) : (
            <button type="button" onClick={() => setEditing(true)} className="chip min-h-[44px] whitespace-nowrap bg-sun-soft text-sun-ink">{price.toFixed(2)} / kWh · Edit</button>
          )}
        </div>

        <div className="inner flex flex-col gap-1.5 p-3 text-sm">
          <span className={market.demo ? "text-bad" : "text-good"}>{market.demo ? "Building Pi unreachable" : "Marketplace live"}</span>
          {offer ? (
            <span className="text-xs text-muted">Offering {Number(offer.kwh).toFixed(3)} kWh until {new Date(Number(offer.window_end) * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
          ) : (
            <span className="text-xs text-muted">No measured offer is currently open.</span>
          )}
        </div>

        {orders.filter((o) => o.status === "open").map((o) => (
          <div key={o.order_id} className="inner flex items-center gap-2.5 px-3 py-2.5">
            <span className="flex flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium">Order #{o.order_id} · routing now</span>
              <span className="text-xs text-muted">{(Number(o.want_wh) / 1000).toFixed(3)} kWh prepaid by {short(o.shop)}</span>
            </span>
            <span className="text-xs font-medium text-good">OPEN</span>
          </div>
        ))}

        {sales.map((s) => (
          <div key={s.orderId} className="inner flex flex-col gap-1.5 px-3 py-2.5">
            <span className="flex items-center gap-2.5">
              <span className="flex flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium">{s.name || short(s.buyer)}</span>
                <span className="text-xs text-muted">{s.kwh.toFixed(3)} kWh delivered · order #{s.orderId}{s.refunded ? ` · ${s.refunded.toFixed(4)} refunded` : ""}</span>
              </span>
              <span className="text-[13px] font-medium">{s.usdc.toFixed(4)} USDC</span>
            </span>
            <span className="flex flex-wrap gap-1.5 text-[11px]"><Proof kind="arc" id={s.arcTx} /><Proof kind="arkiv" id={s.key} /></span>
          </div>
        ))}
        {!market.demo && orders.length === 0 && sales.length === 0 && <span className="text-sm text-muted">No Arc orders or settled sales yet.</span>}
        {note && <span className="text-xs text-sun-ink">{note}</span>}
      </section>

      <section className="card flex flex-col gap-1.5 rounded-[14px]">
        <div className="flex items-center justify-between pb-1">
          <span className="flex flex-col gap-0.5"><span className="text-base font-medium">Maintenance records</span><span className="text-xs text-muted">{fromArkiv.live ? "Read live from Arkiv" : "Arkiv unavailable"}</span></span>
          <button type="button" className="btn" onClick={() => setAdding((a) => !a)}>{adding ? "Cancel" : "Add record"}</button>
        </div>
        {adding && (
          <form onSubmit={addRecord} className="inner flex flex-col gap-2 p-3">
            <input className="rounded-lg border border-line bg-card-solid px-3 py-2 text-sm outline-none" placeholder="What was done (e.g. Wiring check)" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <input className="rounded-lg border border-line bg-card-solid px-3 py-2 text-sm outline-none" placeholder="Details" value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
            <button type="submit" className="btn">Save record</button>
          </form>
        )}
        {records.map((m, i) => (
          <div key={i} className={`grid grid-cols-[54px_minmax(0,1fr)_auto] items-center gap-2.5 py-2.5 ${i < records.length - 1 ? "border-b border-line" : ""}`}>
            <span className="text-xs text-muted">{m.date}</span>
            <span className="flex flex-col"><span className="text-sm font-medium">{m.title}</span><span className="text-xs text-muted">{m.text}</span></span>
            <span className="flex flex-col items-end gap-1 text-[11px]">{m.arcTx && <Proof kind="arc" id={m.arcTx} />}{m.key && <Proof kind="arkiv" id={m.key} />}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
