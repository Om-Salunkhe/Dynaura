import { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader.jsx";
import { admin } from "../data/demo.js";
import { postJSON } from "../lib/api.js";
import { txUrl } from "../lib/arc.js";
import { fetchMaintenance, short, useArkiv } from "../lib/arkiv.js";

export default function AdminTrading() {
  const [price, setPrice] = useState(admin.price);
  const [editing, setEditing] = useState(false);
  const fromArkiv = useArkiv(() => fetchMaintenance(20), null);
  const [records, setRecords] = useState(admin.maintenance);
  const [note, setNote] = useState("");
  useEffect(() => {
    if (fromArkiv.live)
      setRecords(fromArkiv.data.map((m) => ({ date: m.date, title: m.title, text: m.text, link: m.arcTx ? `Arc ${short(m.arcTx)}` : `Arkiv ${short(m.key)}`, href: m.arcTx ? txUrl(m.arcTx) : null })));
  }, [fromArkiv]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ title: "", text: "" });

  const addRecord = (e) => {
    e.preventDefault();
    if (!draft.title.trim()) return;
    const date = new Date().toISOString().slice(0, 10);
    const rec = { title: draft.title.trim(), details: draft.text.trim() || "Added by admin" };
    postJSON("/api/admin/maintenance", rec, { admin: true })
      .then((r) => setNote(`Saved on Arkiv · ${short(r.key)}`))
      .catch(() => setNote("Pi or Arkiv not reachable: saved on this screen only"));
    setRecords((r) => [{ date, title: rec.title, text: rec.details, link: "Arkiv" }, ...r]);
    setDraft({ title: "", text: "" });
    setAdding(false);
  };

  return (
    <div className="flex flex-col gap-3">
      <PageHeader kicker="Admin · Sunrise Apartments" title="Trading and upkeep" />

      <section className="card flex flex-col gap-2.5 rounded-[24px]">
        <div className="flex items-center justify-between gap-2">
          <span className="flex flex-col gap-0.5">
            <span className="text-base font-bold">Selling spare solar</span>
            <span className="text-xs text-muted">To nearby shops and offices, paid in USDC on Arc</span>
          </span>
          {editing ? (
            <label className="chip bg-sun-soft text-sun-ink">
              <input
                type="number"
                step="0.01"
                min="0"
                className="w-14 bg-transparent text-right font-bold outline-none"
                value={price}
                onChange={(e) => setPrice(Number(e.target.value))}
                onBlur={() => {
                  setEditing(false);
                  postJSON("/api/admin/price", { price_usdc: price }, { admin: true }).catch(() => {});
                }}
                autoFocus
              />
              / kWh
            </label>
          ) : (
            <button type="button" onClick={() => setEditing(true)} className="chip min-h-[44px] whitespace-nowrap bg-sun-soft text-sun-ink">
              {price.toFixed(2)} / kWh · Edit
            </button>
          )}
        </div>
        {admin.sales.map((s) => (
          <div key={s.buyer} className="inner flex items-center gap-2.5 px-3 py-2.5">
            <span className="flex flex-1 flex-col gap-0.5">
              <span className="text-sm font-bold">{s.buyer}</span>
              <span className="text-xs text-muted">
                {s.kwh} kWh · {s.when}
              </span>
            </span>
            <span className="text-[13px] font-bold text-ink-2" title="Demo sale: no transaction">
              {(s.kwh * s.price).toFixed(2)} USDC
            </span>
          </div>
        ))}
      </section>

      <section className="card flex flex-col gap-1.5 rounded-[24px]">
        <div className="flex items-center justify-between pb-1">
          <span className="flex flex-col gap-0.5">
            <span className="text-base font-bold">Maintenance records</span>
            <span className="text-xs text-muted">{fromArkiv.live ? "Read live from Arkiv" : "Kept on Arkiv · demo data"}</span>
            {note && <span className="text-xs text-sun-ink">{note}</span>}
          </span>
          <button type="button" className="btn" onClick={() => setAdding((a) => !a)}>
            {adding ? "Cancel" : "Add record"}
          </button>
        </div>
        {adding && (
          <form onSubmit={addRecord} className="inner flex flex-col gap-2 p-3">
            <input
              className="rounded-lg border border-line bg-card-solid px-3 py-2 text-sm outline-none"
              placeholder="What was done (e.g. Wiring check)"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
            <input
              className="rounded-lg border border-line bg-card-solid px-3 py-2 text-sm outline-none"
              placeholder="Details"
              value={draft.text}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            />
            <button type="submit" className="btn">
              Save record
            </button>
          </form>
        )}
        {records.map((m, i) => (
          <div key={i} className={`grid grid-cols-[54px_minmax(0,1fr)_auto] items-center gap-2.5 py-2.5 ${i < records.length - 1 ? "border-b border-line" : ""}`}>
            <span className="text-xs text-muted">{m.date}</span>
            <span className="flex flex-col">
              <span className="text-sm font-bold">{m.title}</span>
              <span className="text-xs text-muted">{m.text}</span>
            </span>
            {m.href ? (
              <a href={m.href} target="_blank" rel="noreferrer" className="text-xs font-bold text-link">
                {m.link}
              </a>
            ) : (
              <span className="text-xs font-bold text-muted">{m.link}</span>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
