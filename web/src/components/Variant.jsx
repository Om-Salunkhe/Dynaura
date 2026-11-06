import { Suspense } from "react";
import { useDesign } from "../lib/design.js";

/**
 * Renders the current screen, or its lazy-loaded twin when the Twin design is on.
 * `twin` must be a React.lazy component created once at module level, so the default
 * bundle never contains twin code.
 */
export default function Variant({ current: Current, twin: Twin }) {
  const design = useDesign();
  if (design !== "twin" || !Twin) return <Current />;
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted">Loading…</div>}>
      <Twin />
    </Suspense>
  );
}
