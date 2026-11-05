import { short, txUrl } from "../lib/arc.js";
import { ogStorageUrl } from "../lib/hero.js";
import { isFakeId } from "../lib/scene.js";

/**
 * One proof: an Arc tx, a 0G Storage root, or a plain hash (kind "hash", never linked). Demo ids are shown as "demo" and never linked,
 * so nobody clicks through to a hash that doesn't exist.
 */
export default function Proof({ kind = "arc", id, label, className = "" }) {
  if (!id) return null;
  const fake = isFakeId(id);
  const name = label || (kind === "arc" ? "Arc tx" : "0G proof");
  const href = fake ? null : kind === "arc" ? txUrl(id) : kind === "og" ? ogStorageUrl(id) : null;
  const tone = kind === "arc" ? "text-link" : kind === "og" ? "text-sun-ink" : "text-ink-2";
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
