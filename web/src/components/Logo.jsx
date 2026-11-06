import { useId } from "react";

/** Dynaura's mark: one sun cut into three equal bands, one for each flat. */
export default function Logo({ size = 28, className = "", title = "Dynaura" }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <svg width={size} height={size} viewBox="7 7 50 50" role="img" aria-label={title} className={className}>
      <defs>
        <linearGradient id={`dy-g-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFE3A8" />
          <stop offset="0.45" stopColor="#F7A93E" />
          <stop offset="1" stopColor="#E2600E" />
        </linearGradient>
        <clipPath id={`dy-c-${id}`}>
          <circle cx="32" cy="32" r="24" />
        </clipPath>
      </defs>
      <g clipPath={`url(#dy-c-${id})`} fill={`url(#dy-g-${id})`}>
        <rect x="0" y="8" width="64" height="14.6" />
        <rect x="0" y="24.7" width="64" height="14.6" />
        <rect x="0" y="41.4" width="64" height="14.6" />
      </g>
    </svg>
  );
}
