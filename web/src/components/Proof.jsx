import { short, txUrl } from "../lib/arc.js";
import { ogStorageUrl } from "../lib/hero.js";
import { isFakeId } from "../lib/scene.js";

/**
 * One proof: an Arc tx or a 0G Storage root. Demo ids are shown as "demo" and never linked,
 * so nobody clicks through to a hash that doesn't exist.
 */
export default function Proof({ kind = "arc", id, label, className = "" }) {
  if (!id) return null;
  const fake = isFakeId(id);
  const name = label || (kind === "arc" ? "Arc tx" : "0G proof");
  const href = fake ? null : kind === "arc" ? txUrl(id) : ogStorageUrl(id);
  const tone = kind === "arc" ? "text-link" : "text-sun-ink";
  const body = (
    <>
      <span className="font-extrabold">{name}</span>
      <span className="mono opacity-80">{fake ? "demo" : short(id)}</span>
    </>
  );
  const cls = `inline-flex items-center gap-1.5 rounded-full bg-inner px-2.5 py-1 ${tone} ${className}`;
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={`${cls} underline-offset-2 hover:underline`}>
      {body}
    </a>
  ) : (
    <span className={cls} title={fake ? "Demo data: no real transaction" : id}>
      {body}
    </span>
  );
}
