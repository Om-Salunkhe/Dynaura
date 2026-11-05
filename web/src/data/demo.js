// Demo data so every screen works before the Pi, 0G, Arc and Arkiv are wired in.
// Numbers are at model scale (the cardboard building), like the real meters.

const HOME_W = { A: 0.42, B: 0.03, C: 0.38 };

export function demoState() {
  const jitter = () => 1 + (Math.random() - 0.5) * 0.04;
  const meters = {
    panel: { v: 5.0, ma: 420 * jitter(), w: +(2.1 * jitter()).toFixed(3) },
    A: { v: 5.0, ma: 84, w: +(HOME_W.A * jitter()).toFixed(3) },
    B: { v: 5.0, ma: 6, w: +(HOME_W.B * jitter()).toFixed(3) },
    C: { v: 5.0, ma: 76, w: +(HOME_W.C * jitter()).toFixed(3) },
  };
  return {
    ts: Date.now() / 1000,
    meters,
    flats: {
      A: { source: "solar", away: false },
      B: { source: "grid", away: true },
      C: { source: "solar", away: false },
    },
    pump: { on: true },
    solar_w: meters.panel.w,
    used_w: +(meters.A.w + meters.B.w + meters.C.w).toFixed(3),
  };
}

export const today = {
  A: { kwh: 0.61, solarPct: 72, cost: 0.14 },
  B: { kwh: 0.08, solarPct: 90, cost: 0.02 },
  C: { kwh: 0.74, solarPct: 64, cost: 0.19 },
};

// share of each hour 6 AM to 5 PM: [solar, grid] relative heights (0-1)
export const hourly = [
  [0, 0.3], [0.1, 0.32], [0.12, 0.13], [0.2, 0], [0.7, 0], [0.88, 0],
  [0.6, 0], null, null, null, null, null,
];

export const recommendations = [
  { icon: "washer", title: "Run the washer at 10:30", why: "Peak sun · saves 0.9 kWh of grid" },
  { icon: "heater", title: "Heat water at 13:30, not 7 PM", why: "Your evening use is 80% grid" },
  { icon: "car", title: "Charge the scooter after 11:00", why: "Strong sun until 3 PM tomorrow" },
];

export const plan = {
  date: "Thu 6 Nov",
  forecastKwh: 9.6,
  split: { flats: 5.6, common: 3.3, buffer: 0.7 },
  requestId: "0x7f3a…c21e",
  groups: [
    {
      name: "Water",
      jobs: [
        { name: "Overhead tank", icon: "water", start: 9.5, hours: 1, label: "Running now", running: true },
        { name: "Borewell pump", icon: "water", start: 12.5, hours: 0.5, label: "12:30 · 30 min" },
        { name: "RO drinking water", icon: "water", start: 12, hours: 1, label: "12:00 · 1 h" },
      ],
    },
    {
      name: "Charging",
      jobs: [
        { name: "EV charge point", icon: "car", start: 11, hours: 2, label: "11:00 · 2 h" },
        { name: "Lift backup battery", icon: "bolt", start: 13, hours: 1, label: "1 PM · 1 h" },
      ],
    },
    {
      name: "Upkeep",
      jobs: [
        { name: "Garden sprinklers", icon: "leaf", start: 10.5, hours: 0.5, label: "10:30 · 30 min" },
        { name: "Pool filter", icon: "water", start: 11, hours: 2, label: "11:00 · 2 h" },
      ],
    },
  ],
};

export const bill = {
  month: "November",
  flat: "A",
  owe: 4.2,
  credit: 0.35,
  solarPct: 72,
  solarKwh: 3.4,
  gridKwh: 1.3,
  commonShare: "1/3",
  rule: "Fixed share · India",
  due: "30 Nov",
  past: [
    { month: "October", amount: 3.85, status: "Paid" },
    { month: "September", amount: 4.02, status: "Paid" },
  ],
};

export const panelWeek = [
  { day: "Fri", pct: 94 },
  { day: "Sat", pct: 91 },
  { day: "Sun", pct: 54 },
  { day: "Mon", pct: 58 },
  { day: "Tue", pct: 96 },
  { day: "Wed", pct: 95 },
  { day: "Thu", pct: 97 },
];

export const timeline = [
  { kind: "ai", when: "Today 12:00", title: "AI decision", text: "Tank pump on solar, Flat B's share sent to Flat C", proof: "0G proof 0xa91c…04be" },
  { kind: "clean", when: "Mon", title: "Panel cleaned", text: "Output back to 96%, cleaner paid 2.00 USDC", proof: "Arc tx · job #3" },
  { kind: "alert", when: "Sun", title: "Dust alert", text: "54% of forecast on a clear day", proof: "0G proof 0x3d07…e811" },
  { kind: "bill", when: "1 Nov", title: "Bill settled", text: "October split across 3 flats", proof: "Arc tx" },
];

export const admin = {
  month: "November",
  generatedKwh: 38.4,
  forecastPct: 96,
  usedKwh: 31.9,
  flatsKwh: 22.1,
  commonKwh: 9.8,
  discomKwh: 6.5,
  p2pKwh: 2.9,
  p2pUsdc: 0.23,
  flats: [
    { id: "A", label: "Flat A · Ground", kwh: 8.2, usdc: 4.2, solarPct: 72, note: "" },
    { id: "B", label: "Flat B · 1st", kwh: 4.7, usdc: 1.95, solarPct: 80, note: "Away 9 days" },
    { id: "C", label: "Flat C · 2nd", kwh: 9.2, usdc: 5.1, solarPct: 64, note: "" },
  ],
  discomWeek: [40, 22, 12, 8, 100, 46, 28],
  discomNote: "Tue peak: Flat B away and pool filter off",
  price: 0.08,
  sales: [
    { buyer: "Corner grocery · shop", kwh: 1.2, when: "Tue 12:00", price: 0.1 },
    { buyer: "Tech park office · IT", kwh: 0.9, when: "Mon 13:00", price: 0.07 },
    { buyer: "Lane café · shop", kwh: 0.8, when: "Sun 12:30", price: 0.06 },
  ],
  maintenance: [
    { date: "2 Nov", title: "Panel cleaning", text: "52% to 96% · Ravi", link: "Arc tx" },
    { date: "28 Oct", title: "Panel cleaning", text: "60% to 94% · Ravi", link: "Arc tx" },
    { date: "15 Oct", title: "Wiring check", text: "Meters and fuse OK", link: "Arkiv" },
    { date: "1 Oct", title: "Installed", text: "5 W panel, 4 meters", link: "Arkiv" },
  ],
};

export const panel = {
  pct: 52,
  alertLine: 70,
  forecastW: 2.1,
  actualW: 1.09,
  fee: 2.0,
  deadline: "Fri 6 PM",
  record: "5 W · installed Oct 2026 · 3 cleanings",
};

export const cleaner = {
  name: "Ravi",
  earned: 6.0,
  done: 2,
  job: {
    building: "Sunrise Apartments",
    where: "Andheri East · 1 roof panel · at 52% output",
    ends: "Ends Fri, 6 PM",
    fee: 2.0,
  },
  paid: [{ id: 3, when: "Mon", text: "52% to 96% output", amount: 2.0 }],
};

export const dynaChat = [
  { from: "me", text: "Why was I on grid at 7 PM yesterday?" },
  {
    from: "dyna",
    text: [
      "Your geyser ran from 7:05 to 7:50 PM, after sunset, so it used 0.7 kWh from the grid.",
      "Tomorrow's sun is strong. Heating at 13:30 instead would run on solar and save about 0.04 USDC.",
    ],
    actions: ["Set geyser for 13:30", "Not now"],
    proof: "Answered on 0G · TEE verified · 0x51be…9a02",
  },
  { from: "me", text: "How much did sharing earn me?" },
  {
    from: "dyna",
    text: ["While you were away this month, 1.2 kWh of your spare sun went to Flat C. That's a 0.35 USDC credit on your November bill."],
    proof: "From Arkiv records · 0G · 0x8c2d…11f7",
  },
];
