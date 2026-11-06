import { useEffect, useState } from "react";
import { getJSON, useLive } from "../lib/api.js";
import {
  clearPiUrl,
  closeConnection,
  defaultPiUrl,
  isBlocked,
  isValidPiUrl,
  lockAdmin,
  openConnection,
  piHost,
  setAdminKey,
  setPiUrl,
  useConnection,
} from "../lib/connection.js";
import Icon from "./Icon.jsx";

/** "Live · Pi dynaura.local:8000" or "Demo data · Pi not reachable (no answer)" */
function useStatus() {
  const live = useLive();
  const { piUrl } = useConnection();
  if (!live.demo) return { label: `Live · Pi ${piHost(piUrl)}`, tone: "bg-sun-soft text-sun-ink", dot: "animate-pulse bg-sun" };
  const reason = live.reason || "no answer";
  const bad = live.blocked || !isValidPiUrl(piUrl);
  return {
    label: `Demo data · Pi not reachable (${reason})`,
    tone: bad ? "bg-[rgba(180,35,24,0.12)] text-bad" : "bg-inner text-muted",
    dot: bad ? "bg-bad" : "bg-idle",
  };
}

/** Connection state in the page header (tablet and up). Tap it to change the Pi or unlock admin. */
export function ConnectionPill({ size = "md" }) {
  const st = useStatus();
  const xl = size === "xl";
  return (
    <button
      type="button"
      onClick={() => openConnection()}
      title={`${st.label} · tap to change the Pi address or the admin key`}
      className={`chip max-w-[420px] whitespace-nowrap ${st.tone} ${xl ? "px-5 py-3 text-lg" : "hidden py-1.5 text-[11px] sm:inline-flex"}`}
    >
      <span className={`flex-none rounded-full ${st.dot} ${xl ? "h-3 w-3" : "h-2 w-2"}`} />
      <span className="truncate">{st.label}</span>
    </button>
  );
}

/** The same state as a slim bar on phones, where the header has no room for it. */
export function ConnectionBar() {
  const st = useStatus();
  return (
    <button
      type="button"
      onClick={() => openConnection()}
      className={`mb-3 flex w-full items-center gap-2 rounded-full px-3 py-1.5 text-left text-[11px] font-bold sm:hidden ${st.tone}`}
    >
      <span className={`h-2 w-2 flex-none rounded-full ${st.dot}`} />
      <span className="truncate">{st.label}</span>
      <span className="ml-auto flex-none opacity-70">Change</span>
    </button>
  );
}

/** https page + http Pi: say plainly why it shows demo data and how to fix it. */
export function MixedContentBanner() {
  const { piUrl } = useConnection();
  if (!isBlocked(piUrl)) return null;
  return (
    <section role="alert" className="mb-3 flex flex-col gap-2 rounded-[22px] border-2 border-bad bg-[rgba(180,35,24,0.10)] p-4 text-sm">
      <span className="text-[11px] font-extrabold tracking-wider text-bad">PI URL MUST BE HTTPS</span>
      <span className="font-bold">
        This page is https, so the browser blocks the http Pi at <span className="mono">{piUrl}</span>. You're seeing demo data.
      </span>
      <span className="text-xs text-ink-2">
        On the Pi, start the tunnel: <span className="mono">cloudflared tunnel --url http://localhost:8000</span>. Paste the https address it
        prints here, or open this page with <span className="mono">?pi=https://….trycloudflare.com</span>.
      </span>
      <button type="button" className="btn-ghost self-start" onClick={() => openConnection()}>
        Set the Pi address
      </button>
    </section>
  );
}

/** The Connection dialog: Pi address (change, test, reset) and the admin key (unlock, lock). */
export function ConnectionDialog() {
  const conn = useConnection();
  const [url, setUrl] = useState(conn.piUrl);
  const [key, setKey] = useState("");
  const [check, setCheck] = useState(null);

  useEffect(() => {
    if (conn.open) {
      setUrl(conn.piUrl);
      setKey("");
      setCheck(null);
    }
  }, [conn.open, conn.piUrl]);

  useEffect(() => {
    if (!conn.open) return undefined;
    const onKey = (e) => e.key === "Escape" && closeConnection();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [conn.open]);

  if (!conn.open) return null;

  const test = async () => {
    setPiUrl(url);
    if (!isValidPiUrl(url)) return setCheck({ bad: true, text: "Use a full address, like https://….trycloudflare.com or http://dynaura.local:8000" });
    if (isBlocked(url)) return setCheck({ bad: true, text: "Blocked: this https page can't reach an http address. Use the https tunnel URL." });
    setCheck({ text: "Checking…" });
    try {
      const h = await getJSON("/api/health", { timeout: 4000 });
      setCheck({ ok: true, text: `Pi is up · hardware ${h.hw} · Arc ${h.arc?.enabled ? "on" : "off"} · Arkiv ${h.arkiv?.ok ? "ok" : "off"}` });
    } catch (e) {
      setCheck({ bad: true, text: `No answer from ${piHost(url)}: ${e.name === "AbortError" ? "timed out" : e.message}` });
    }
  };

  const save = () => {
    setPiUrl(url);
    if (key.trim()) setAdminKey(key);
    closeConnection();
  };

  const reset = () => {
    clearPiUrl();
    setUrl(defaultPiUrl());
    setCheck({ text: `Back to the default: ${defaultPiUrl()}` });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm" onClick={closeConnection}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Connection"
        className="flex w-full max-w-md flex-col gap-3 rounded-[26px] border border-line bg-card-solid p-5 shadow-nav"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="text-lg font-extrabold">Connection</span>
          <button type="button" aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full bg-inner" onClick={closeConnection}>
            <Icon name="close" size={16} />
          </button>
        </div>
        {conn.reason && <span className="chip bg-sun-soft py-2 text-xs text-sun-ink">{conn.reason}</span>}

        <label className="inner flex flex-col gap-1 p-3 text-xs text-muted">
          Pi address (on Vercel: the https tunnel URL)
          <input
            className="mono bg-transparent text-sm font-bold text-ink outline-none"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://….trycloudflare.com"
            spellCheck={false}
            autoCapitalize="off"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn-ghost" onClick={test}>
            Test the Pi
          </button>
          <button type="button" className="btn-ghost" onClick={reset}>
            Clear (use default)
          </button>
        </div>
        {check && <span className={`text-xs ${check.bad ? "text-bad" : check.ok ? "text-good" : "text-muted"}`}>{check.text}</span>}

        <div className="my-1 h-px bg-line" />
        {conn.adminKey ? (
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm font-bold text-good">
              <Icon name="check" size={16} /> Admin unlocked on this browser
            </span>
            <button type="button" className="btn-ghost" onClick={lockAdmin}>
              <Icon name="lock" size={14} />
              <span className="pl-1.5">Lock</span>
            </button>
          </div>
        ) : (
          <label className="inner flex flex-col gap-1 p-3 text-xs text-muted">
            Committee admin key (unlocks admin actions; stays in this browser until you lock it)
            <input
              className="mono bg-transparent text-sm font-bold text-ink outline-none"
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="locked"
              autoComplete="off"
            />
          </label>
        )}

        <button type="button" className="btn" onClick={save}>
          {key.trim() ? "Save and unlock admin" : "Save"}
        </button>
      </div>
    </div>
  );
}
