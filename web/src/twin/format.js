// Numbers for the twin screens. The cardboard model is metered in watts; the app shows it at
// building scale (×1000, the same scale the bills use), so 1.08 W on the meter reads 1.08 kW.
export const SCALE_NOTE = "Model building: readings shown at building scale (1 W on the meter = 1 kW)";

export const kw = (w, digits = 2) => (w == null || Number.isNaN(+w) ? "–" : (+w).toFixed(digits));

// Approximate, for orientation only (USDC is the money; ₹ is shown so residents can read it)
export const INR_PER_USDC = 88;
export const inr = (usdc) =>
  usdc == null ? "–" : `≈ ₹${Math.round(usdc * INR_PER_USDC).toLocaleString("en-IN")}`;

export const usdc = (x) => (x == null ? "–" : (+x).toFixed(2));
export const pct = (x) => (x == null ? "–" : `${Math.round(x)}%`);
export const shortHash = (h) => (h && h.length > 12 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h || "");
