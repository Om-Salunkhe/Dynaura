import { Link } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import Logo from "../components/Logo.jsx";
import { useLive } from "../lib/api.js";

const SPONSORS = [
  {
    name: "0G",
    role: "Decides",
    line: "The AI that runs the building, with proof of every decision.",
    uses: [
      "Plans each day: which flats run on sun, when the pump and chargers run.",
      "Looks at the panel: a vision check tells dust from clouds before any money moves.",
      "Sells the spare sun: prices neighbour trades by scarcity, sends the rest to the shop or the grid.",
      "Logs every decision to 0G Storage and records it in a registry on 0G Chain.",
    ],
    proof: { label: "EpisodeRegistry on 0G Chain", href: "https://chainscan-galileo.0g.ai/address/0xb62f4531f035d5cd188799d96bac553b5d7da984" },
  },
  {
    name: "Arc",
    role: "Pays",
    line: "USDC that moves only when the meter says so.",
    uses: [
      "Holds the cleaner's fee in escrow, released only when the meter proves the panel is clean.",
      "Splits the building's solar income by each flat's unused share, computed on chain.",
      "Splits each bill between solar and grid, and settles spare sun sold to the shop next door.",
      "Contracts written, tested and deployed in Arc Studio; disputes go to the committee wallet.",
    ],
    proof: { label: "SolarCredits on Arc", href: "https://explorer.testnet.arc.io/address/0x12b06e364ecc08aead9ce2142382682b9d46859c" },
  },
  {
    name: "Arkiv",
    role: "Remembers",
    line: "The building's record book, readable by anyone.",
    uses: [
      "Keeps signed meter readings, decisions, bills and jobs as records anyone can query.",
      "Lets records expire on purpose: offers at sunset, and a missed heartbeat is the offline alarm.",
      "Hands the cleaner a work receipt their own wallet owns, so no one can delete it.",
      "Backs one-click payout checks: readings from Arkiv, proof from Arc, decision from 0G.",
    ],
    proof: { label: "The building's records on Arkiv", href: "https://rabdi.explorer.arkiv.network/address/0xd961a5C42dd84F003Ef3C85a1bD08BE59A8717Cd" },
  },
];

export default function Landing() {
  return (
    <div className="landing grain relative isolate min-h-screen overflow-x-hidden bg-black text-white">
      <LandingNav />
      <Hero />
      <LiveStrip />
      <BuiltOn />
      <footer className="mx-auto flex max-w-[1120px] flex-col gap-2 border-t border-white/[0.07] px-6 py-10 text-[12.5px] text-white/40 sm:flex-row sm:justify-between">
        <span>Dynaura · built at ETHGlobal Mumbai 2026</span>
        <span>A 3-flat model building, one roof, real meters.</span>
      </footer>
    </div>
  );
}

function LandingNav() {
  return (
    <div className="fixed inset-x-0 top-4 z-30 px-4 sm:top-6 sm:px-8">
      <header className="glass mx-auto flex h-[50px] max-w-[1120px] items-center gap-3 rounded-[16px] pl-4 pr-1.5">
        <span className="flex items-center gap-2.5">
          <Logo size={26} />
          <span className="text-[15.5px] font-medium tracking-[-0.2px]">Dynaura</span>
        </span>
        <nav className="ml-auto hidden items-center gap-1 text-[13px] text-white/60 md:flex">
          <a href="#how" className="rounded-full px-3 py-1.5 hover:text-white">
            How it works
          </a>
          <a href="#live" className="rounded-full px-3 py-1.5 hover:text-white">
            Live
          </a>
          <Link to="/shop" className="rounded-full px-3 py-1.5 hover:text-white">
            Marketplace
          </Link>
          <Link to="/scenarios" className="rounded-full px-3 py-1.5 hover:text-white">
            Scenarios
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
    <section className="relative flex min-h-[100svh] items-center justify-center px-0 pb-16 pt-28">
      <div className="glow" aria-hidden="true">
        <span className="g2" />
        <span className="g1" />
        <span className="g4" />
        <span className="g3" />
      </div>
      <div className="relative z-10 mx-auto flex w-full max-w-[860px] flex-col items-center px-6 text-center">
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
            to="/shop"
            className="glass flex h-11 items-center gap-2 rounded-[12px] px-5 text-[14px] text-white/85 transition-colors hover:text-white"
          >
            Open live marketplace
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
    <section id="live" className="mx-auto mt-4 max-w-[1120px] px-6">
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

function BuiltOn() {
  return (
    <section id="how" className="mx-auto mb-24 mt-24 max-w-[1120px] px-6 sm:mb-32 sm:mt-32">
      <h2 className="m-0 max-w-[680px] text-[30px] font-light leading-tight tracking-[-0.03em] sm:text-[40px]">
        Built on 0G, Arc and Arkiv.
      </h2>
      <p className="m-0 mt-4 max-w-[620px] text-[15px] font-light leading-relaxed text-white/55">
        0G decides, Arc pays, Arkiv remembers. Every payout can be traced through all three: the decision, the money and
        the meter readings behind it.
      </p>
      <div className="mt-10 grid grid-cols-1 gap-px overflow-hidden rounded-[14px] border border-white/[0.08] bg-white/[0.08] md:grid-cols-3">
        {SPONSORS.map((sp) => (
          <div key={sp.name} className="flex flex-col gap-4 bg-black px-6 py-7">
            <span className="flex items-baseline justify-between gap-3">
              <span className="text-[26px] font-light tracking-[-0.02em]">{sp.name}</span>
              <span className="mono text-[11px] uppercase tracking-[0.12em] text-[#f7b75e]">{sp.role}</span>
            </span>
            <p className="m-0 text-[14.5px] font-light leading-snug text-white/85">{sp.line}</p>
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {sp.uses.map((u) => (
                <li key={u} className="flex gap-2.5 text-[13.5px] font-light leading-relaxed text-white/55">
                  <span className="mt-[9px] h-1 w-1 flex-none rounded-full bg-[#f5a53c]" />
                  {u}
                </li>
              ))}
            </ul>
            <a
              href={sp.proof.href}
              target="_blank"
              rel="noreferrer"
              className="mono mt-auto pt-2 text-[11.5px] text-white/45 transition-colors hover:text-white"
            >
              {sp.proof.label} ↗
            </a>
          </div>
        ))}
      </div>
    </section>
  );
}
