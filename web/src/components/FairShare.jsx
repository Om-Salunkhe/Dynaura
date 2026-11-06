// Bill page: "Your share of the sun". Share vs used vs unused, what the spare earned against an
// equal split, the trades that sold it (with their 0G request ids), and Claim on Arc.
import { useState } from "react";
import { ARC_READY, ensureAllowance, errText, short, write } from "../lib/arc.js";
import { flatName, units, usdc, useCredits, useCreditsChain } from "../lib/credits.js";
import { isFakeId } from "../lib/scene.js";
import Proof from "./Proof.jsx";

const shortId = (id) => (id && id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id || "");
const time = (t) => new Date(t * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
// trader.py sends window as ["12:00", "12:15"]; the demo as one string
const windowText = (w) => (Array.isArray(w) ? w.join("–") : w);
/** Trades that actually sold something (trader.py logs "none" when there's no spare). */
export const soldTrades = (trades) => (trades || []).filter((t) => t.mode !== "none" && (t.routes || []).some((r) => r.wh > 0));

function Bar({ label, wh, max, tone, note }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-[12.5px]">
        <span className="text-muted">{label}</span>
        <span className="font-medium">
          {units(wh)}
          {note ? <span className="text-muted"> · {note}</span> : null}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-inner">
        <span className={`block h-full rounded-full ${tone}`} style={{ width: `${max ? Math.min(100, (wh / max) * 100) : 0}%` }} />
      </div>
    </div>
  );
}

/** One 0G trade: where the spare went, at what price, and why. */
export function TradeRow({ t }) {
  return (
    <div className="flex flex-col gap-1 border-t border-line py-2.5 first-of-type:border-0">
      <span className="text-[11px] text-muted">
        {windowText(t.window) || (t.at ? time(t.at) : "")} · {t.mode === "ai" ? "decided on 0G" : "no-ai: 0G unreachable, spare to the grid"}
      </span>
      <span className="text-[13px]">
        {t.routes
          .filter((r) => r.wh > 0)
          .map((r) => `${units(r.wh)} → ${flatName(r.to)} at ${r.price}`)
          .join(" · ")}
      </span>
      {t.reason && <span className="text-[12px] text-ink-2">“{t.reason}”</span>}
      {((t.mode === "ai" && t.request_id) || t.key) && (
        <span className="flex flex-wrap items-center gap-2">
          {t.mode === "ai" && t.request_id && (
            <span className="mono text-[11px] text-muted" title={t.request_id}>
              0G · req {isFakeId(t.request_id) ? "demo" : shortId(t.request_id)}
            </span>
          )}
          {t.key && <Proof kind="arkiv" id={t.key} label="Read from Arkiv" className="text-[11px]" />}
        </span>
      )}
    </div>
  );
}

export default function FairShare({ flat }) {
  const [period, setPeriod] = useState("today");
  const c = useCredits(period);
  const [claimed, setClaimed] = useState(null);
  if (c.status === "off" || c.status === "loading" || !c.data) {
    return c.status === "error" ? (
      <section className="card rounded-[14px] text-[12.5px] text-muted">Your share of the sun: the Pi didn't answer ({c.error}).</section>
    ) : null;
  }
  const d = c.data;
  const me = d.flats?.[flat];
  if (!me) return null;
  const max = Math.max(me.share_wh, me.used_wh, 1);
  const trades = soldTrades(d.trades).slice(-3).reverse();
  const chain = d.chain || {};

  const claim = () => setClaimed(true); // demo only; live claims are in <OnChain>

  return (
    <section className="card flex flex-col gap-3 rounded-[14px]">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="text-base font-medium">Your share of the sun</span>
          {c.demo && <span className="chip bg-inner text-muted">Demo</span>}
        </span>
        {!c.demo && (
          <span role="tablist" className="flex rounded-[9px] border border-line p-0.5 text-[12px]">
            {["today", "month"].map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={period === p}
                onClick={() => setPeriod(p)}
                className={`rounded-[7px] px-2.5 py-1 ${period === p ? "bg-inner font-medium text-ink" : "text-muted"}`}
              >
                {p === "today" ? "Today" : "Month"}
              </button>
            ))}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        <Bar label="Your fair share" wh={me.share_wh} max={max} tone="bg-ink-2" />
        <Bar label="You used" wh={me.used_wh} max={max} tone="bg-sun" />
        {me.over_wh > 0 ? (
          <Bar label="Over your share" wh={me.over_wh} max={max} tone="bg-grid" note="bought from neighbours" />
        ) : (
          <Bar label="You left unused" wh={me.unused_wh} max={max} tone="bg-good" />
        )}
      </div>

      <p className="m-0 text-[14px] leading-relaxed">
        {me.unused_wh > 0 ? (
          <>
            Your spare {units(me.unused_wh)} earned <span className="font-medium text-good">{usdc(me.earned_usdc)}</span>. An equal split would give{" "}
            {usdc(me.equal_split_usdc)}.
          </>
        ) : me.over_wh > 0 ? (
          <>
            You used {units(me.over_wh)} more than your share. You pay your neighbours <span className="font-medium">{usdc(me.owes_usdc)}</span> for them, at{" "}
            {d.pool?.prices?.neighbor} a unit.
          </>
        ) : (
          "You used exactly your share: nothing to sell, nothing to buy."
        )}
      </p>
      <span className="text-[11.5px] text-muted">
        Units are kWh. Each flat is paid for the share it left unused ({units(d.spare_wh)} spare in the building), not an equal split.
      </span>

      {trades.length > 0 && (
        <div className="flex flex-col">
          <span className="text-[12px] font-medium text-ink-2">Where the spare was sold</span>
          {trades.map((t, i) => (
            <TradeRow key={`${t.at}-${i}`} t={t} />
          ))}
        </div>
      )}

      {c.demo ? (
        me.earned_usdc > 0 && (
          <div className="flex flex-col gap-1.5 border-t border-line pt-3">
            {claimed ? (
              <span className="text-[12.5px] text-good">Claimed (demo)</span>
            ) : (
              <button type="button" className="btn self-start" onClick={claim}>{`Claim ${usdc(me.earned_usdc)} on Arc`}</button>
            )}
            <span className="text-[11.5px] text-muted">Demo: the claim is simulated. Live, SolarCredits pays it from the pool on Arc, computed on chain.</span>
          </div>
        )
      ) : (
        (me.earned_usdc > 0 || me.over_wh > 0) && <OnChain flat={flat} chain={chain} claimTxFromPi={chain.claims?.[flat]} />
      )}
    </section>
  );
}

/** The period on Arc (SolarCredits): claim what's owed, or pay in for sun bought from neighbours. */
function OnChain({ flat, chain, claimTxFromPi }) {
  const on = useCreditsChain(chain.period_id, flat);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [tx, setTx] = useState(null);
  const shell = (children) => <div className="flex flex-col gap-1.5 border-t border-line pt-3">{children}</div>;
  if (!chain.period_id) return shell(<span className="text-[11.5px] text-muted">Not settled on Arc yet: the committee settles the period, then it can be claimed.</span>);
  if (!ARC_READY.credits) return shell(<span className="text-[11.5px] text-muted">SolarCredits isn't set in this app (VITE_ARC_CREDITS).</span>);
  if (!on) return shell(<span className="text-[11.5px] text-muted">Reading the period on Arc…</span>);
  if (on.error) return shell(<span className="text-[11.5px] text-bad">Couldn't read SolarCredits: {on.error}</span>);
  if (!on.posted || !on.inPeriod) return shell(<span className="text-[11.5px] text-muted">This period isn't on Arc yet for Flat {flat}.</span>);

  const run = async (which, fn) => {
    setBusy(which);
    setErr(null);
    try {
      setTx(await fn());
      on.reload();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  };
  const doneTx = tx || claimTxFromPi;
  const owes = Number(on.owesUnits) / 1e6;

  return shell(
    <>
      {on.claimed > 0 ? (
        <span className="text-[12.5px] text-good">
          ✓ {usdc(on.claimed)} paid to Flat {flat}'s wallet <span className="mono">{short(on.wallet)}</span>
        </span>
      ) : on.claimable > 0 ? (
        <>
          <button type="button" className="btn self-start" disabled={!!busy || on.noWallet} onClick={() => run("claim", () => write("credits", "claim", [chain.period_id, flat]))}>
            {busy === "claim" ? "Confirm in your wallet…" : `Claim ${usdc(on.claimable)} on Arc`}
          </button>
          <span className="text-[11.5px] text-muted">
            {on.noWallet
              ? `Flat ${flat} has no wallet registered on SolarCredits yet: the committee registers it.`
              : `Anyone can send the claim; the USDC always goes to Flat ${flat}'s wallet ${short(on.wallet)}. Computed on chain from the unused share.`}
          </span>
        </>
      ) : null}
      {owes > 0 &&
        (on.paidIn ? (
          <span className="text-[12.5px] text-good">✓ Paid your neighbours {usdc(owes)} on Arc</span>
        ) : (
          <>
            <button
              type="button"
              className="btn-ghost self-start"
              disabled={!!busy}
              onClick={() =>
                run("pay", async () => {
                  await ensureAllowance("credits", on.owesUnits);
                  return write("credits", "payIn", [chain.period_id, flat]);
                })
              }
            >
              {busy === "pay" ? "Confirm in your wallet…" : `Pay neighbours ${usdc(owes)}`}
            </button>
            <span className="text-[11.5px] text-muted">For the sun you used beyond your share; it goes into the pool the flats that saved are paid from.</span>
          </>
        ))}
      {doneTx && <Proof kind="arc" id={doneTx} label="Arc tx" className="self-start text-xs" />}
      {err && <span className="text-[12px] text-bad">{err}</span>}
    </>,
  );
}
