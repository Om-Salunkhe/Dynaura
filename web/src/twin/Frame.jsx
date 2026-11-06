// Placeholder frame for the Twin design while its visual brief is pending.
// Shows the same live values the current screens use, to prove the wiring; no styling decisions yet.
import PageHeader from "../components/PageHeader.jsx";
import { setDesign } from "../lib/design.js";

export default function Frame({ screen, rows, children, header = true }) {
  return (
    <div className="flex flex-col gap-3">
      {header && <PageHeader kicker="Twin design · placeholder" title={screen} />}
      <section className="card flex flex-col gap-2 rounded-[22px] text-sm">
        <span className="text-xs text-muted">Twin screen for “{screen}”. Same hooks and data as the current design; the visual design comes next.</span>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="mono m-0 break-all">{v ?? "–"}</dd>
            </div>
          ))}
        </dl>
        {children}
        <button type="button" className="btn-ghost self-start" onClick={() => setDesign("current")}>
          Back to the current design
        </button>
      </section>
    </div>
  );
}

export const w = (x) => (x == null ? null : `${Number(x).toFixed(2)} W`);
