import { useState } from "react";
import DemoBadge from "../components/DemoBadge.jsx";
import FairShare from "../components/FairShare.jsx";
import Icon from "../components/Icon.jsx";
import PageHeader from "../components/PageHeader.jsx";
import Proof from "../components/Proof.jsx";
import WalletButton from "../components/WalletButton.jsx";
import { bill as demoBill } from "../data/demo.js";
import { postJSON, usePi } from "../lib/api.js";
import { fetchBills, useArkiv } from "../lib/arkiv.js";
import { useConnection } from "../lib/connection.js";
import { ARC_READY, ensureAllowance, errText, txUrl, write } from "../lib/arc.js";
import { FLATS, useRole } from "../lib/role.jsx";

const monthName = (m) => new Date(`${m}-01T00:00:00`).toLocaleString([], { month: "long" });

export default function Bill() {
  const [who] = useRole();
  const flat = FLATS[who.flat];
  const pi = usePi(`/api/bill?flat=${who.flat}`, null);
  const { adminKey } = useConnection();
  const ark = useArkiv(() => fetchBills({ flat: who.flat }), null, [who.flat]);
  // newest first from Arkiv; a re-posted month keeps only its newest bill
  const arkBills = ark.live || (ark.limited && Array.isArray(ark.data)) ? ark.data.filter((p, i, all) => all.findIndex((q) => q.month === p.month) === i) : null;
  const live = !pi.demo && pi.data;
  const [demoPaid, setDemoPaid] = useState(false);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [tx, setTx] = useState(null);

  const b = live
    ? {
        month: monthName(pi.data.month),
        owe: pi.data.usdc,
        credit: pi.data.saved_usdc,
        solarPct: pi.data.solar_pct,
        solarKwh: pi.data.solar_kwh,
        gridKwh: pi.data.grid_kwh,
        rule: `Solar ${pi.data.solar_rate} · grid ${pi.data.grid_rate} USDC/kWh`,
      }
    : demoBill;
  const pct = b.solarPct;
  const paid = live ? pi.data.paid : demoPaid;
  const canPay = live && pi.data.bill_id > 0 && ARC_READY.billing && !paid;

  const pay = async () => {
    if (!live) return setDemoPaid(true);
    setBusy("pay");
    setErr(null);
    try {
      await ensureAllowance("billing", BigInt(Math.round(pi.data.posted_usdc * 1e6)));
      setTx(await write("billing", "pay", [BigInt(pi.data.bill_id)]));
      pi.reload();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const postBills = async () => {
    setBusy("post");
    setErr(null);
    try {
      await postJSON("/api/admin/bills", {}, { admin: true });
      pi.reload();
    } catch (e) {
      setErr(`${e.message}. Is SolarBilling set up on the Pi (ARC_BILLING) and does its wallet hold USDC for gas?`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <PageHeader kicker={`${flat.name} · split by what your meter measured`} title={`${b.month} bill`} right={live ? <WalletButton /> : null} />
      <p className="m-0 -mt-2 text-[13.5px] leading-relaxed text-muted">
        Your flat's power this month. <span className="text-ink-2">You pay for what your own meter used</span>, and{" "}
        <span className="text-ink-2">you earn for the sun you left for your neighbours</span>.
      </p>

      <SectionTitle
        title="What you owe"
        sub="Billed from your flat's own meter. One USDC payment on Arc, split automatically between the society (solar) and the grid."
      />
      <section className="card flex items-center gap-5 rounded-[14px] p-5">
        <div
          className="grid h-28 w-28 flex-none place-items-center rounded-full"
          style={{ background: `conic-gradient(var(--sun) 0 ${pct}%, var(--grid) ${pct}% 100%)` }}
          role="img"
          aria-label={`${pct}% solar`}
        >
          <div className="grid h-[84px] w-[84px] place-items-center rounded-full bg-card-solid text-center">
            <span className="leading-tight">
              <span className="block text-xl font-medium">{pct}%</span>
              <span className="text-[11px] text-muted">solar</span>
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-2 text-[13px] text-muted">
            You owe <DemoBadge demo={!live} />
          </span>
          <span className="flex items-baseline gap-1">
            <span className="text-[40px] font-light leading-none tracking-[-1px]">{b.owe.toFixed(2)}</span>
            <span className="text-sm text-muted">USDC</span>
          </span>
          <span className="chip w-fit bg-sun-soft py-1 text-xs text-sun-ink">
            {b.credit.toFixed(2)} saved by solar
          </span>
        </div>
      </section>

      <section className="card flex flex-col gap-2 rounded-[14px]">
        {live && !pi.data.bill_id ? (
          <>
            <span className="text-center text-sm text-muted">This bill is not on Arc yet. The committee posts all three flats' bills together.</span>
            {adminKey && pi.data.arc && (
              <button type="button" className="btn min-h-[52px] text-[15px]" onClick={postBills} disabled={busy === "post"}>
                {busy === "post" ? "Posting on Arc…" : `Post ${b.month} bills on Arc (admin)`}
              </button>
            )}
          </>
        ) : (
          <button type="button" className="btn min-h-[52px] text-[15px]" onClick={pay} disabled={paid || busy === "pay" || (live && !canPay)}>
            {paid ? (
              <>
                <Icon name="check" size={18} />
                &nbsp;Paid on Arc{live ? "" : " (demo)"}
              </>
            ) : busy === "pay" ? (
              "Confirm in your wallet…"
            ) : (
              `Pay ${(live ? pi.data.posted_usdc : b.owe).toFixed(2)} USDC on Arc`
            )}
          </button>
        )}
        {tx && (
          <a className="text-center text-xs font-medium text-link" href={txUrl(tx)} target="_blank" rel="noreferrer">
            View payment on Arc
          </a>
        )}
        {err && <span className="text-center text-xs text-bad">{err}</span>}
        <span className="text-center text-xs text-muted">{live ? "Goes straight to the society treasury" : `Due ${demoBill.due}`} · settles in under a second</span>
      </section>

      <section className="card flex flex-col divide-y divide-line rounded-[14px] py-1">
        <Line k="Solar you used" v={`${b.solarKwh} kWh`} />
        <Line k="Grid you used" v={`${b.gridKwh} kWh`} />
        {!live && <Line k="Your share of common area" v={demoBill.commonShare} />}
        <Line k="Rates" v={b.rule} />
        {live && <Line k="Proof" v={<span className="mono text-xs">{pi.data.readings_hash.slice(0, 10)}… of {pi.data.minutes} signed minutes</span>} />}
      </section>

      <SectionTitle
        title="What you earned"
        sub="Your fair share of the panel. Sun you didn't use is sold to a neighbour, the shop or the grid, and you're paid for your part of it."
      />
      <FairShare flat={who.flat} />

      {arkBills?.length > 0 && (
        <section className="card flex flex-col gap-1 rounded-[14px]">
          <span className="text-base font-medium">Bills on Arkiv</span>
          <span className="pb-1 text-xs text-muted">Read straight from Arkiv: anyone can check them</span>
          {arkBills.map((p) => (
            <div key={p.key} className="flex flex-col gap-1.5 border-t border-line py-2.5 text-sm first-of-type:border-0">
              <div className="flex items-center justify-between">
                <span className="font-medium">{monthName(p.month)}</span>
                <span className="font-medium">{p.usdc.toFixed(2)} USDC</span>
              </div>
              <span className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="text-muted">
                  {p.kwh.toFixed(2)} kWh · {p.solarPct}% solar
                </span>
                <Proof kind="arc" id={p.arcTx} />
                <Proof kind="arkiv" id={p.key} />
              </span>
            </div>
          ))}
        </section>
      )}

      {!live && !arkBills?.length && (
        <section className="card flex flex-col gap-1 rounded-[14px]">
          <span className="pb-1 text-base font-medium">Past bills</span>
          {demoBill.past.map((p) => (
            <div key={p.month} className="flex items-center justify-between py-2 text-sm">
              <span className="font-medium">{p.month}</span>
              <span className="font-medium">{p.amount.toFixed(2)} USDC</span>
              <span className="text-xs font-medium text-muted">{p.status}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function Line({ k, v }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 text-sm">
      <span className="text-muted">{k}</span>
      <span className="text-right font-medium">{v}</span>
    </div>
  );
}

function SectionTitle({ title, sub }) {
  return (
    <div className="mt-3 flex flex-col gap-0.5 px-1">
      <span className="text-[15px] font-medium">{title}</span>
      {sub && <span className="text-[12.5px] leading-relaxed text-muted">{sub}</span>}
    </div>
  );
}
