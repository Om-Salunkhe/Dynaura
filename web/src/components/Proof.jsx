import { short, txUrl } from "../lib/arc.js";
import { entityUrl } from "../lib/arkiv.js";
import { ogTxUrl, useOgRootUrl } from "../lib/ogLinks.js";
import { isFakeId } from "../lib/scene.js";

const KINDS = {
  arc: { name: "Arc tx", tone: "text-link", href: txUrl },
  og: { name: "0G proof", tone: "text-sun-ink" }, // storage root: link resolved lazily
  ogtx: { name: "0G registry", tone: "text-sun-ink", href: ogTxUrl },
  arkiv: { name: "Arkiv", tone: "text-good", href: entityUrl },
  hash: { name: "Hash", tone: "text-ink-2" }, // never linked
};

/**
 * One proof chip: an Arc tx, a 0G Storage root, a 0G registry tx, an Arkiv entity, or a plain hash.
 * Demo ids are shown as "demo" and never linked, so nobody clicks through to something that doesn't exist.
 */
export default function Proof({ kind = "arc", id, label, className = "" }) {
  const fake = isFakeId(id);
  const k = KINDS[kind] || KINDS.hash;
  const ogUrl = useOgRootUrl(id, kind === "og" && !fake);
  if (!id) return null;
  const href = fake ? null : kind === "og" ? ogUrl : k.href ? k.href(id) : null;
  const body = (
    <>
      <span className="font-medium">{label || k.name}</span>
      <span className="mono opacity-80">{fake ? "demo" : short(id)}</span>
    </>
  );
  const cls = `inline-flex items-center gap-1.5 rounded-full bg-inner px-2.5 py-1 ${k.tone} ${className}`;
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={`${cls} underline-offset-2 hover:underline`}>
      {body}
    </a>
  ) : (
    <span className={cls} title={fake ? "Demo data: no real record" : kind === "og" ? `${id} (not on storagescan yet)` : id}>
      {body}
    </span>
  );
}
