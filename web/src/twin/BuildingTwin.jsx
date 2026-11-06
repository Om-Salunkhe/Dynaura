// The building is the interface: a matte elevation of the 3-flat model. Only energy has colour:
// amber solar from the panel, blue grid from the street, teal water to the roof tank. Dashes move
// faster with more watts. Each flat's windows are lit by its source (dark when away). Labels sit
// outside on thin leader lines. A dusty panel gets a matte haze and an alert outline.
import { useEffect, useState } from "react";
import { kw } from "./format.js";

/** true on phone-width screens (labels inside the drawing would be too small to read) */
function usePhone() {
  const q = "(max-width: 639px)";
  const [on, setOn] = useState(() => typeof window !== "undefined" && window.matchMedia?.(q).matches);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return undefined;
    const f = () => setOn(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return on;
}

const C = {
  building: "#3b3b3d",
  building2: "#4a4a4d",
  parapet: "#333335",
  away: "#2a2a2c",
  idleOut: "#cfcbc4",
  idleOn: "#4f4f52",
  ink: "#1b1b1a",
  muted: "#6b6862",
  solar: "#f2a900",
  grid: "#2f6fed",
  water: "#1c9aa6",
  alert: "#c2410c",
  panel: "#23272b",
  cell: "#3b4147",
};

// floors top to bottom
const FLOORS = [
  { f: "C", top: 182 },
  { f: "B", top: 288 },
  { f: "A", top: 394 },
];
const BUS = 90; // busbar offset under the windows

const dur = (w) => `${Math.min(6, Math.max(0.5, 1.6 / (0.25 + Math.max(0, w || 0)))).toFixed(2)}s`;

function Conduit({ d, on, color, w, sw, onFacade = false }) {
  if (!on) return <path d={d} fill="none" stroke={onFacade ? C.idleOn : C.idleOut} strokeWidth={sw * 0.7} strokeLinecap="round" strokeLinejoin="round" />;
  return (
    <g>
      <path d={d} fill="none" stroke={color} strokeOpacity="0.32" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      <path className="t-flow" style={{ animationDuration: dur(w) }} d={d} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

function Label({ x, y, anchor = "start", caps, value, tone = C.ink, fs }) {
  return (
    <g fontFamily="inherit">
      <text x={x} y={y} textAnchor={anchor} fontSize={fs.caps} letterSpacing={fs.caps * 0.12} fontWeight="600" fill={C.muted}>
        {caps}
      </text>
      <text x={x} y={y + fs.value * 1.15} textAnchor={anchor} fontSize={fs.value} fontWeight="500" fill={tone} style={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
      </text>
    </g>
  );
}

/**
 * b: { flats: {A,B,C:{source,away}}, meters: {panel,A,B,C:{w}}, pump, pumpTimer, offline }
 * panel: { pct, expectedW, dusty }
 */
export default function BuildingTwin({ b, panel = {}, size = "app", className = "", labels: wantLabels = true }) {
  const big = size === "projector";
  const phone = usePhone() && !big;
  const labels = wantLabels && !phone;
  const sw = big ? 4 : 3;
  const lw = big ? 2 : 1.25; // leader lines
  const fs = big ? { caps: 15, value: 26 } : { caps: 12.5, value: 19 };
  const flats = b.flats || {};
  const m = b.meters || {};
  const panelW = m.panel?.w ?? 0;
  const onSolar = (f) => !flats[f]?.away && flats[f]?.source === "solar";
  const onGrid = (f) => !flats[f]?.away && flats[f]?.source !== "solar";
  const anySolar = ["A", "B", "C"].some(onSolar);
  const gridW = ["A", "B", "C"].filter(onGrid).reduce((s, f) => s + (m[f]?.w || 0), 0);
  const anyGrid = ["A", "B", "C"].some(onGrid);
  const pumpOn = !!b.pump;
  const haze = panel.pct == null ? 0 : Math.min(0.72, Math.max(0, (92 - panel.pct) / 45));
  const dusty = !!panel.dusty;
  const panelPts = "286,158 452,158 438,104 300,104";

  const flatValue = (f) => {
    if (flats[f]?.away) return "away";
    return `${kw(m[f]?.w)} kW · ${onSolar(f) ? "solar" : "grid"}`;
  };
  const summary = `Building: panel ${kw(panelW)} kW${panel.pct != null ? ` at ${Math.round(panel.pct)}% of expected` : ""}. ${["C", "B", "A"]
    .map((f) => `Flat ${f} ${flatValue(f)}`)
    .join(", ")}. Pump ${pumpOn ? "on" : "off"}.`;

  const legend = [
    ["Panel", panelW < 0.01 ? "0.00 kW · idle" : `${kw(panelW)} kW${panel.pct != null ? ` · ${Math.round(panel.pct)}%` : ""}`, dusty],
    ...["C", "B", "A"].map((f) => [`Flat ${f}`, flatValue(f), false]),
    ["Grid", `${kw(gridW)} kW`, false],
    ["Pump", b.pumpTimer ? "on · timer" : pumpOn ? "on · solar" : "off", false],
  ];

  return (
    <div className={className}>
    <svg viewBox={phone ? "130 80 590 440" : "0 0 880 570"} role="img" aria-label={summary} style={{ display: "block", width: "100%", height: "auto" }}>
      {/* ground */}
      <line x1="20" y1="500" x2="860" y2="500" stroke={C.idleOut} strokeWidth={lw} />

      {/* conduits outside the building */}
      <Conduit d="M290,158 H244 V484" on={anySolar && panelW > 0.01} color={C.solar} w={panelW} sw={sw} />
      <Conduit d="M830,480 H516 V272" on={anyGrid} color={C.grid} w={gridW} sw={sw} />
      <Conduit d="M168,470 V92 H481 V116" on={pumpOn} color={C.water} w={0.8} sw={sw} />

      {/* grid pole */}
      <line x1="830" y1="414" x2="830" y2="500" stroke={C.building2} strokeWidth={sw * 0.9} strokeLinecap="round" />
      <line x1="816" y1="424" x2="844" y2="424" stroke={C.building2} strokeWidth={sw * 0.8} strokeLinecap="round" />

      {/* pump */}
      <rect x="148" y="470" width="40" height="30" rx="4" fill={C.building2} />
      <circle cx="168" cy="485" r="7" fill="none" stroke={pumpOn ? C.water : C.idleOn} strokeWidth="2.5" />

      {/* building */}
      <rect x="254" y="170" width="252" height="12" fill={C.parapet} />
      <rect x="260" y="182" width="240" height="318" fill={C.building} />
      {FLOORS.slice(1).map(({ top }) => (
        <line key={top} x1="260" y1={top} x2="500" y2={top} stroke={C.building2} strokeWidth="2" />
      ))}

      {/* roof tank */}
      <rect x="466" y="116" width="30" height="54" rx="6" fill={C.building2} />
      <line x1="472" y1="128" x2="490" y2="128" stroke={pumpOn ? C.water : C.idleOn} strokeWidth="2" strokeLinecap="round" />

      {/* panel on its frame */}
      <line x1="300" y1="158" x2="300" y2="170" stroke={C.building2} strokeWidth="3" />
      <line x1="438" y1="158" x2="438" y2="170" stroke={C.building2} strokeWidth="3" />
      <polygon points={panelPts} fill={C.panel} />
      {[1, 2, 3, 4, 5].map((i) => {
        const t = i / 6;
        return <line key={`v${i}`} x1={286 + 166 * t} y1="158" x2={300 + 138 * t} y2="104" stroke={C.cell} strokeWidth="1" />;
      })}
      {[1, 2].map((i) => {
        const t = i / 3;
        const y = 158 - 54 * t;
        return <line key={`h${i}`} x1={286 + 14 * t} y1={y} x2={452 - 14 * t} y2={y} stroke={C.cell} strokeWidth="1" />;
      })}
      {haze > 0 && <polygon points={panelPts} fill="#e4e1db" opacity={haze} />}
      <polygon points={panelPts} fill="none" stroke={dusty ? C.alert : "#5a5e63"} strokeWidth={dusty ? sw * 0.8 : 1.5} strokeLinejoin="round" />

      {/* flats: windows lit by source, a busbar under them carrying that source */}
      {FLOORS.map(({ f, top }) => {
        const solar = onSolar(f);
        const grid = onGrid(f);
        const glass = flats[f]?.away ? C.away : solar ? C.solar : C.grid;
        const y = top + BUS;
        return (
          <g key={f}>
            {[282, 347, 412].map((x) => (
              <g key={x}>
                <rect x={x} y={top + 22} width="46" height="52" fill={glass} opacity={flats[f]?.away ? 1 : 0.94} />
                <line x1={x + 23} y1={top + 22} x2={x + 23} y2={top + 74} stroke={C.building} strokeWidth="2" />
              </g>
            ))}
            <Conduit d={`M244,${y} H488`} on={solar} color={C.solar} w={m[f]?.w} sw={sw * 0.8} onFacade />
            {grid && <Conduit d={`M516,${y} H272`} on color={C.grid} w={m[f]?.w} sw={sw * 0.8} onFacade />}
          </g>
        );
      })}

      {labels && (
        <g>
          {/* panel: above, vertical leader */}
          <line x1="369" y1="58" x2="369" y2="102" stroke={C.ink} strokeWidth={lw} />
          <Label
            x={369}
            y={22}
            anchor="middle"
            caps={dusty ? "PANEL · DUSTY" : "PANEL"}
            value={panelW < 0.01 ? "0.00 kW · idle" : `${kw(panelW)} kW${panel.pct != null ? ` · ${Math.round(panel.pct)}%` : ""}`}
            tone={dusty ? C.alert : C.ink}
            fs={fs}
          />
          {/* flats: right, horizontal leaders */}
          {FLOORS.map(({ f, top }) => (
            <g key={f}>
              <line x1="500" y1={top + 48} x2="584" y2={top + 48} stroke={C.ink} strokeWidth={lw} />
              <Label x={592} y={top + 40} caps={`FLAT ${f}`} value={flatValue(f)} tone={flats[f]?.away ? C.muted : C.ink} fs={fs} />
            </g>
          ))}
          {/* grid and pump: below */}
          <Label x={830} y={526} anchor="end" caps="GRID" value={`${kw(gridW)} kW`} fs={fs} />
          <Label x={148} y={526} caps="PUMP" value={b.pumpTimer ? "on · timer" : pumpOn ? "on · solar" : "off"} fs={fs} />
        </g>
      )}
    </svg>
    {phone && wantLabels && (
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
        {legend.map(([k, v, alert]) => (
          <div key={k} className="flex flex-col">
            <dt className="t-caps">{k}</dt>
            <dd className="t-num m-0 text-[15px]" style={{ color: alert ? "var(--t-alert)" : "var(--t-ink)" }}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
    )}
    </div>
  );
}
