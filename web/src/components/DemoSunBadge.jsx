import { usePi } from "../lib/api.js";

/** Shown next to any spare-sun number while the Pi runs with DEMO_SUN_SCALE > 1: the model's panel is tiny,
 *  so the demo multiplies its sun. Never hidden; 0G's decisions and the Arc and Arkiv records stay real. */
export default function DemoSunBadge({ className = "" }) {
  const h = usePi("/api/health", null);
  const k = !h.demo ? Number(h.data?.demo_sun_scale) : 0;
  if (!(k > 1)) return null;
  return (
    <span
      className={`chip bg-sun-soft text-sun-ink ${className}`}
      title="The model's panel is tiny, so this demo multiplies its sun. 0G's decisions and the Arc and Arkiv records are real."
    >
      Demo sun ×{Number.isInteger(k) ? k : k.toFixed(1)}
    </span>
  );
}
