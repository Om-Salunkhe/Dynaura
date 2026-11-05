import { useState } from "react";
import Icon from "../components/Icon.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { bill } from "../data/demo.js";
import { FLATS, useRole } from "../lib/role.jsx";

export default function Bill() {
  const [who] = useRole();
  const flat = FLATS[who.flat];
  const [paid, setPaid] = useState(false);
  const pct = bill.solarPct;

  return (
    <div className="flex flex-col gap-3">
      <PageHeader kicker={`${flat.name} · split by what your meter measured`} title={`${bill.month} bill`} />

      <section className="card flex items-center gap-5 rounded-[26px] p-5">
        <div
          className="grid h-28 w-28 flex-none place-items-center rounded-full"
          style={{ background: `conic-gradient(var(--sun) 0 ${pct}%, var(--grid) ${pct}% 100%)` }}
          role="img"
          aria-label={`${pct}% solar`}
        >
          <div className="grid h-[84px] w-[84px] place-items-center rounded-full bg-card-solid text-center">
            <span className="leading-tight">
              <span className="block text-xl font-extrabold">{pct}%</span>
              <span className="text-[11px] text-muted">solar</span>
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[13px] text-muted">You owe</span>
          <span className="flex items-baseline gap-1">
            <span className="text-[40px] font-extrabold leading-none tracking-[-1px]">{bill.owe.toFixed(2)}</span>
            <span className="text-sm text-muted">USDC</span>
          </span>
          <span className="chip w-fit bg-sun-soft py-1 text-xs text-sun-ink">{bill.credit.toFixed(2)} credit for sharing</span>
        </div>
      </section>

      <section className="card flex flex-col gap-2 rounded-[26px]">
        <button type="button" className="btn min-h-[52px] text-[15px]" onClick={() => setPaid(true)} disabled={paid}>
          {paid ? (
            <>
              <Icon name="check" size={18} />
              &nbsp;Paid on Arc (demo)
            </>
          ) : (
            `Pay ${bill.owe.toFixed(2)} USDC on Arc`
          )}
        </button>
        <span className="text-center text-xs text-muted">Due {bill.due} · settles in under a second</span>
      </section>

      <section className="card flex flex-col divide-y divide-line rounded-[26px] py-1">
        <Line k="Solar you used" v={`${bill.solarKwh} kWh`} />
        <Line k="Grid you used" v={`${bill.gridKwh} kWh`} />
        <Line k="Your share of common area" v={bill.commonShare} />
        <Line k="Sharing rule" v={bill.rule} />
      </section>

      <section className="card flex flex-col gap-1 rounded-[26px]">
        <span className="pb-1 text-base font-bold">Past bills</span>
        {bill.past.map((b) => (
          <div key={b.month} className="flex items-center justify-between py-2 text-sm">
            <span className="font-semibold">{b.month}</span>
            <span className="font-bold">{b.amount.toFixed(2)} USDC</span>
            <a href="#" className="text-xs font-bold text-link">
              {b.status} · Arc tx
            </a>
          </div>
        ))}
      </section>
    </div>
  );
}

function Line({ k, v }) {
  return (
    <div className="flex items-center justify-between py-3 text-sm">
      <span className="text-muted">{k}</span>
      <span className="font-bold">{v}</span>
    </div>
  );
}
