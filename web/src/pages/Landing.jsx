import { Link } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { useLive } from "../lib/api.js";

const PILLARS = [
  {
    verb: "Decides",
    who: "0G Compute",
    text: "Dyna reads tomorrow's sun and moves pumps, chargers and spare solar into it. Every plan carries its 0G request ID and TEE check.",
  },
  {
    verb: "Pays",
    who: "Arc · USDC",
    text: "Bills, shop trades and the panel-cleaning escrow settle in USDC. The cleaner is paid only when the meter proves the panel is clean.",
  },
  {
    verb: "Remembers",
    who: "Arkiv",
    text: "Readings and decisions are kept as expiring records that any resident can query. No database to trust.",
  },
];

const FLOW = ["Dust on the panel", "0G confirms it", "USDC escrow opens", "Panel cleaned", "Meter back above 90%", "Cleaner paid"];

export default function Landing() {
  return (
    <div className="landing grain relative isolate min-h-screen overflow-x-hidden bg-black text-white">
      <LandingNav />
      <Hero />
      <LiveStrip />
      <Pillars />
      <Flow />
      <footer className="mx-auto flex max-w-[1120px] flex-col gap-2 border-t border-white/[0.07] px-6 py-10 text-[12.5px] text-white/40 sm:flex-row sm:justify-between">
        <span>Dynaura · built at ETHGlobal Mumbai 2026</span>
        <span>A 3-flat model building, one roof, real meters.</span>
      </footer>
    </div>
  );
}

function LandingNav() {
  return (
    <div className="fixed inset-x-0 top-3 z-30 px-3 sm:px-6">
      <header className="glass mx-auto flex h-[50px] max-w-[1120px] items-center gap-3 rounded-[16px] pl-4 pr-1.5">
        <span className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-gradient-to-br from-[#f7b955] to-[#e9860f] text-[#1a1206] shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
            <Icon name="sun" size={16} stroke={2.2} />
          </span>
          <span className="text-[15.5px] font-medium tracking-[-0.2px]">Dynaura</span>
        </span>
        <nav className="ml-auto hidden items-center gap-1 text-[13px] text-white/60 md:flex">
          <a href="#how" className="rounded-full px-3 py-1.5 hover:text-white">
            How it works
          </a>
          <a href="#live" className="rounded-full px-3 py-1.5 hover:text-white">
            Live
          </a>
          <Link to="/demo" className="rounded-full px-3 py-1.5 hover:text-white">
            Demo
          </Link>
        </nav>
        <Link
          to="/home"
          className="ml-auto flex h-9 items-center gap-1.5 rounded-[11px] bg-white px-3.5 text-[13px] font-medium text-black transition-opacity hover:opacity-90 md:ml-2"
        >
          Open app <Icon name="arrowRight" size={14} stroke={2} />
        </Link>
      </header>
    </div>
  );
}

function Hero() {
  return (
    <section className="relative pb-6 pt-36 sm:pt-44">
      <div className="glow" aria-hidden="true">
        <span className="g2" />
        <span className="g1" />
        <span className="g4" />
        <span className="g3" />
      </div>
      <div className="relative z-10 mx-auto flex max-w-[860px] flex-col items-center px-6 text-center">
        <h1 className="m-0 text-[46px] font-light leading-[1.02] tracking-[-0.045em] sm:text-[80px]">
          One roof. Every flat.
          <br />
          <span className="text-white/55">Run by the sun.</span>
        </h1>
        <p className="mt-7 max-w-[580px] text-[15.5px] font-light leading-relaxed text-white/65 sm:text-[17px]">
          Dynaura is an AI that runs a building's shared solar: it plans the day on 0G, settles every unit in USDC on Arc,
          and keeps an open record on Arkiv.
        </p>
        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
          <Link
            to="/home"
            className="flex h-11 items-center gap-2 rounded-[12px] bg-white px-5 text-[14px] font-medium text-black transition-opacity hover:opacity-90"
          >
            Open the dashboard <Icon name="arrowRight" size={15} stroke={2} />
          </Link>
          <Link
            to="/demo"
            className="glass flex h-11 items-center gap-2 rounded-[12px] px-5 text-[14px] text-white/85 transition-colors hover:text-white"
          >
            Watch the live demo
          </Link>
        </div>
      </div>
    </section>
  );
}

function LiveStrip() {
  const live = useLive();
  const flats = ["A", "B", "C"];
  const onSolar = flats.filter((f) => live.flats?.[f]?.source === "solar").length;
  const used = flats.reduce((t, f) => t + (live.meters?.[f]?.w ?? 0), 0);
  const stats = [
    { k: "Roof right now", v: (live.meters?.panel?.w ?? 0).toFixed(2), u: "W" },
    { k: "Building is using", v: used.toFixed(2), u: "W" },
    { k: "Flats on solar", v: `${onSolar}`, u: "of 3" },
    { k: "Source", v: live.demo ? "Demo" : "Live", u: live.demo ? "Pi offline" : "from the Pi" },
  ];
  return (
    <section id="live" className="mx-auto mt-20 max-w-[1120px] px-6 sm:mt-24">
      <div className="mb-4 flex items-center gap-2 text-[12px] text-white/45">
        <span className={`h-1.5 w-1.5 rounded-full ${live.demo ? "bg-white/30" : "animate-pulse bg-[#3ccf91]"}`} />
        {live.demo ? "Sample readings" : "Live from the roof"} · Sunrise Apartments
      </div>
      <div className="grid grid-cols-2 overflow-hidden rounded-[14px] border border-white/[0.08] sm:grid-cols-4">
        {stats.map((s, i) => (
          <div
            key={s.k}
            className={`flex flex-col gap-2 bg-white/[0.015] px-5 py-5 sm:px-6 ${i % 2 ? "border-l border-white/[0.08]" : ""} ${
              i > 1 ? "border-t border-white/[0.08] sm:border-t-0" : ""
            } ${i === 2 ? "sm:border-l" : ""}`}
          >
            <span className="text-[12px] text-white/45">{s.k}</span>
            <span className="flex items-baseline gap-1.5">
              <span className="num text-[30px] font-light leading-none sm:text-[34px]">{s.v}</span>
              <span className="text-[12.5px] text-white/40">{s.u}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Pillars() {
  return (
    <section id="how" className="mx-auto mt-24 max-w-[1120px] px-6 sm:mt-32">
      <h2 className="m-0 max-w-[620px] text-[30px] font-light leading-tight tracking-[-0.03em] sm:text-[40px]">
        An AI with a body, a wallet and a memory.
      </h2>
      <div className="mt-10 grid grid-cols-1 gap-px overflow-hidden rounded-[14px] border border-white/[0.08] bg-white/[0.08] md:grid-cols-3">
        {PILLARS.map((p) => (
          <div key={p.verb} className="flex flex-col gap-3 bg-black px-6 py-7">
            <span className="flex items-baseline justify-between gap-3">
              <span className="text-[20px] font-light tracking-[-0.02em]">{p.verb}</span>
              <span className="mono text-[11px] text-[#f7b75e]">{p.who}</span>
            </span>
            <p className="m-0 text-[14px] font-light leading-relaxed text-white/55">{p.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Flow() {
  return (
    <section className="mx-auto mb-24 mt-20 max-w-[1120px] px-6 sm:mb-32">
      <span className="text-[12px] text-white/45">The moment we demo</span>
      <p className="m-0 mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[16px] font-light text-white/80 sm:text-[18px]">
        {FLOW.map((step, i) => (
          <span key={step} className="flex items-center gap-3">
            {step}
            {i < FLOW.length - 1 && <span className="text-[#f5a53c]/70">→</span>}
          </span>
        ))}
      </p>
    </section>
  );
}
