import { Link } from "react-router-dom";
import DemoBadge from "../components/DemoBadge.jsx";
import Legend from "../components/Legend.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { admin } from "../data/demo.js";
import { useLive } from "../lib/api.js";

export default function AdminOverview() {
  const live = useLive();
  const maxKwh = Math.max(...admin.flats.map((f) => f.kwh));

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        kicker={`Sunrise Apartments · ${admin.month}`}
        title="Building overview"
        right={<span className="rounded-md bg-btn px-2 py-1 text-[11px] font-extrabold tracking-wider text-btn-ink">ADMIN</span>}
      />

      <div className="grid grid-cols-2 gap-2.5">
        <Tile label="Solar generated" value={`${admin.generatedKwh} kWh`} note={`${admin.forecastPct}% of forecast`} good />
        <Tile label="Used in building" value={`${admin.usedKwh} kWh`} note={`Flats ${admin.flatsKwh} · common ${admin.commonKwh}`} />
        <Tile label="Sent to DISCOM" value={`${admin.discomKwh} kWh`} note="Net-metering credit" />
        <Tile label="Sold to shops" value={`${admin.p2pKwh} kWh`} note={`${admin.p2pUsdc} USDC on Arc`} />
      </div>

      <section className="card flex items-center justify-between rounded-[22px] py-3">
        <span className="flex items-center gap-2 text-sm font-bold">
          Right now <DemoBadge demo={live.demo} />
        </span>
        <span className="text-sm">
          <b className="text-sun-ink">{(live.solar_w ?? 0).toFixed(2)} W</b> solar · <b>{(live.used_w ?? 0).toFixed(2)} W</b> used
        </span>
      </section>

      <section className="card flex flex-col gap-2.5 rounded-[24px]">
        <div className="flex items-center justify-between">
          <span className="text-base font-bold">By flat</span>
          <Legend />
        </div>
        {admin.flats.map((f) => (
          <div key={f.id} className="flex flex-col gap-1.5">
            <div className="flex justify-between text-sm">
              <span className="font-bold">{f.label}</span>
              <span>
                {f.kwh} kWh · {f.usdc.toFixed(2)} USDC
              </span>
            </div>
            <span className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" style={{ width: `${(f.kwh / maxKwh) * 100}%` }}>
              <span className="bg-sun" style={{ width: `${f.solarPct}%` }} />
              <span className="bg-grid" style={{ width: `${100 - f.solarPct}%` }} />
            </span>
            {f.note && <span className="text-[11px] text-muted">{f.note}</span>}
          </div>
        ))}
      </section>

      <section className="card flex flex-col gap-2.5 rounded-[24px]">
        <div className="flex items-baseline justify-between">
          <span className="text-base font-bold">Export to DISCOM</span>
          <span className="text-xs text-muted">last 7 days</span>
        </div>
        <div className="grid h-14 grid-cols-7 items-end gap-2">
          {admin.discomWeek.map((h, i) => (
            <div key={i} className="rounded bg-[#2F9E6A]" style={{ height: `${h}%` }} />
          ))}
        </div>
        <span className="text-xs text-ink-2">{admin.discomNote}</span>
      </section>

      <Link to="/society" className="btn-ghost">
        Edit tomorrow's society jobs
      </Link>
    </div>
  );
}

function Tile({ label, value, note, good }) {
  return (
    <div className="card flex flex-col gap-0.5 rounded-[20px] p-3.5">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-[22px] font-extrabold">{value}</span>
      <span className={`text-[11px] ${good ? "font-bold text-good" : "text-muted"}`}>{note}</span>
    </div>
  );
}
