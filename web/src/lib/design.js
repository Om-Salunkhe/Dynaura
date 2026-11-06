// Which design the screens use: "current" (the default) or "twin" (the new option under review).
// Set by ?design=twin|current in any link (remembered) or in the Connection & settings dialog.
import { useSyncExternalStore } from "react";

const KEY = "dynaura.design";
export const DESIGNS = [
  { key: "current", label: "Current" },
  { key: "twin", label: "Twin" },
];
const valid = (d) => DESIGNS.some((x) => x.key === d);

function initial() {
  try {
    const q = new URLSearchParams(window.location.search).get("design");
    if (valid(q)) {
      localStorage.setItem(KEY, q);
      return q;
    }
    const saved = localStorage.getItem(KEY);
    if (valid(saved)) return saved;
  } catch {}
  return "current";
}

let design = typeof window === "undefined" ? "current" : initial();
const subs = new Set();

export function setDesign(d) {
  if (!valid(d) || d === design) return;
  design = d;
  try {
    localStorage.setItem(KEY, d);
  } catch {}
  subs.forEach((f) => f());
}

export function useDesign() {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => design,
  );
}
