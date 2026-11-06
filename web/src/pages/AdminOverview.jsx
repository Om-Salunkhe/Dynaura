import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import DemoBadge from "../components/DemoBadge.jsx";
import Legend from "../components/Legend.jsx";
import CleaningAlert from "../components/CleaningAlert.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { admin } from "../data/demo.js";
import { useLive } from "../lib/api.js";
import { ARKIV_BUSY_TEXT, ARKIV_READY, fetchHeartbeat, useArkiv } from "../lib/arkiv.js";

/** The Pi renews one Arkiv entity every 30 s with a 2-minute lifetime. If it stops, the entity
 *  expires and this card says "offline": no monitoring server, the expiry is the alarm. */
function Heartbeat() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);
  const hb = useArkiv(fetchHeartbeat, null, [tick]);
  if (!ARKIV_READY) return null;
  const online = hb.live && hb.data;
  const ago = online ? Math.max(0, Math.round(Date.now() / 1000 - hb.data.updated)) : null;
  return (
    <section className="card flex items-center justify-between rounded-[14px] py-3 text-sm">
      <span className="flex items-center gap-2 font-medium">
        <span className={`h-2.5 w-2.5 rounded-full ${online ? "bg-sun" : "bg-bad"}`} />
        {online ? "Building online" : hb.limited ? ARKIV_BUSY_TEXT : hb.error ? "Arkiv not reachable" : "Building offline"}
      </span>
      <span className="text-xs text-muted">
        {online ? `Arkiv heartbeat ${ago}s ago · ${hb.data.mode}` : hb.limited ? "public endpoint out of queries" : hb.error ? "can't read the heartbeat" : "heartbeat expired on Arkiv"}
      </span>
    </section>
  );
}

export default function AdminOverview() {
  const live = useLive();
  const maxKwh = Math.max(...admin.flats.map((f) => f.kwh));

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        kicker={`Sunrise Apartments · ${admin.month}`}
        title="Building overview"
        right={<span className="rounded-md bg-btn px-2 py-1 text-[11px] font-medium tracking-wider text-btn-ink">ADMIN</span>}
      />
      <CleaningAlert />

      <div className="grid grid-cols-2 gap-2.5">
        <Tile label="Solar generated" value={`${admin.generatedKwh} kWh`} note={`${admin.forecastPct}% of forecast`} good />
        <Tile label="Used in building" value={`${admin.usedKwh} kWh`} note={`Flats ${admin.flatsKwh} · common ${admin.commonKwh}`} />
        <Tile label="Sent to DISCOM" value={`${admin.discomKwh} kWh`} note="Net-metering credit" />
        <Tile label="Sold to shops" value={`${admin.p2pKwh} kWh`} note={`${admin.p2pUsdc} USDC on Arc`} />
      </div>

      <Heartbeat />

      <section className="card flex items-center justify-between rounded-[14px] py-3">
        <span className="flex items-center gap-2 text-sm font-medium">
          Right now <DemoBadge demo={live.demo} />
        </span>
        <span className="text-sm">
          <b className="text-sun-ink">{(live.solar_w ?? 0).toFixed(2)} W</b> solar · <b>{(live.used_w ?? 0).toFixed(2)} W</b> used
        </span>
      </section>

      <section className="card flex flex-col gap-2.5 rounded-[14px]">
        <div className="flex items-center justify-between">
          <span className="text-base font-medium">By flat</span>
          <Legend />
        </div>
        {admin.flats.map((f) => (
          <div key={f.id} className="flex flex-col gap-1.5">
            <div className="flex justify-between text-sm">
              <span className="font-medium">{f.label}</span>
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

      <section className="card flex flex-col gap-2.5 rounded-[14px]">
        <div className="flex items-baseline justify-between">
          <span className="text-base font-medium">Export to DISCOM</span>
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
    <div className="card flex flex-col gap-0.5 rounded-[14px] p-3.5">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-[22px] font-medium">{value}</span>
      <span className={`text-[11px] ${good ? "font-medium text-good" : "text-muted"}`}>{note}</span>
    </div>
  );
}
