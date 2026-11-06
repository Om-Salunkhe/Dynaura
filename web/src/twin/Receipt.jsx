// Proofs as neutral receipts: one row per event, monochrome mono chips told apart by text
// (0G · req … · TEE ✓ / ARC · tx … / ARKIV · …), each linking to its explorer.
// On phones the chips collapse to "3 proofs ✓".
import { useState } from "react";
import { txUrl as arcTx } from "../lib/arc.js";
import { entityUrl } from "../lib/arkiv.js";
import { useOgRootUrl } from "../lib/ogLinks.js";
import { isFakeId } from "../lib/scene.js";
import { shortHash } from "./format.js";

function Chip({ kind, id, extra }) {
  const fake = isFakeId(id);
  const ogUrl = useOgRootUrl(id, kind === "og-root" && !fake);
  if (!id) return null;
  const v = fake ? "demo" : shortHash(id);
  const text = {
    "og-req": `0G · req ${v}${extra ? ` · ${extra}` : ""}`,
    "og-root": `0G · root ${v}`,
    arc: `ARC · tx ${v}`,
    arkiv: `ARKIV · ${extra || v}`,
    hash: `METER · ${v}`,
  }[kind];
  const href = fake ? null : kind === "arc" ? arcTx(id) : kind === "arkiv" ? entityUrl(id) : kind === "og-root" ? ogUrl : null;
  return href ? (
    <a className="t-chip" href={href} target="_blank" rel="noreferrer">
      {text}
    </a>
  ) : (
    <span className="t-chip" title={fake ? "Demo data: no real record" : id}>
      {text}
    </span>
  );
}

/** chips: [{ kind, id, extra }] */
export default function Receipt({ title, time, chips = [], size = "app" }) {
  const [open, setOpen] = useState(false);
  const real = chips.filter((c) => c.id);
  const big = size === "projector";
  return (
    <div className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t t-hair ${big ? "py-4" : "py-3"}`}>
      <span className="flex min-w-0 flex-col">
        <span className={big ? "text-[24px] font-medium" : "text-[14px] font-medium"}>{title}</span>
        {time && <span className={`t-num ${big ? "text-[20px]" : "text-[12px]"}`} style={{ color: "var(--t-muted)" }}>{time}</span>}
      </span>
      {real.length > 0 && (
        <>
          {!big && (
            <span className="sm:hidden">
              <button type="button" className="t-chip" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
                {real.length} proof{real.length > 1 ? "s" : ""} ✓
              </button>
            </span>
          )}
          <span className={`${big || open ? "flex" : "hidden sm:flex"} w-full flex-wrap gap-1.5 sm:w-auto ${big ? "[&_.t-chip]:text-[18px]" : ""}`}>
            {real.map((c) => (
              <Chip key={`${c.kind}:${c.id}`} {...c} />
            ))}
          </span>
        </>
      )}
    </div>
  );
}
