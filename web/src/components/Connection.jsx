import { useEffect, useState } from "react";
import { getJSON, useLive } from "../lib/api.js";
import { closeConnection, isBlocked, openConnection, setAdminKey, setPiUrl, useConnection } from "../lib/connection.js";
import Icon from "./Icon.jsx";

/** Live / demo / blocked, on every screen. Tap it to change the Pi address or enter the admin key. */
export function ConnectionPill({ size = "md" }) {
  const live = useLive();
  const blocked = live.blocked;
  const xl = size === "xl";
  const [label, short, tone, dot] = !live.demo
    ? ["Live from the Pi", "Live", "bg-sun-soft text-sun-ink", "animate-pulse bg-sun"]
    : blocked
      ? ["Pi blocked (https)", "Blocked", "bg-[rgba(180,35,24,0.12)] text-bad", "bg-bad"]
      : ["Demo data · no Pi", "Demo", "bg-inner text-muted", "bg-idle"];
  return (
    <button
      type="button"
      onClick={() => openConnection()}
      title="Connection: Pi address and admin key"
      className={`chip whitespace-nowrap ${tone} ${xl ? "px-5 py-3 text-lg" : "py-1.5 text-[11px]"}`}
    >
      <span className={`rounded-full ${dot} ${xl ? "h-3 w-3" : "h-2 w-2"}`} />
      {xl ? label : (
        <>
          {/* phones: just the dot, except when blocked (that one needs words) */}
          <span className={blocked ? "sm:hidden" : "sr-only sm:hidden"}>{short}</span>
          <span className="hidden sm:inline">{label}</span>
        </>
      )}
    </button>
  );
}

/** https page + http Pi: say plainly why it shows demo data and how to fix it. */
export function MixedContentBanner() {
  const { piUrl } = useConnection();
  if (!isBlocked(piUrl)) return null;
  const local = `http://<laptop-ip>:5173${window.location.pathname}`;
  return (
    <section role="alert" className="mb-3 flex flex-col gap-2 rounded-[22px] border-2 border-bad bg-[rgba(180,35,24,0.10)] p-4 text-sm">
      <span className="text-[11px] font-extrabold tracking-wider text-bad">CAN'T REACH THE PI FROM HERE</span>
      <span className="font-bold">
        This page is https and the Pi (<span className="mono">{piUrl}</span>) is http, so the browser blocks it. You're seeing demo data.
      </span>
      <span className="text-xs text-muted">
        Open the app from the laptop on the Pi's Wi-Fi (<span className="mono">{local}</span>), or give the Pi an https address and set it here.
      </span>
      <button type="button" className="btn-ghost self-start" onClick={() => openConnection()}>
        Change the Pi address
      </button>
    </section>
  );
}

/** The Connection dialog: Pi address, admin key, and a quick health check. */
export function ConnectionDialog() {
  const conn = useConnection();
  const [url, setUrl] = useState(conn.piUrl);
  const [key, setKey] = useState(conn.adminKey);
  const [check, setCheck] = useState(null);

  useEffect(() => {
    if (conn.open) {
      setUrl(conn.piUrl);
      setKey(conn.adminKey);
      setCheck(null);
    }
  }, [conn.open, conn.piUrl, conn.adminKey]);

  useEffect(() => {
    if (!conn.open) return undefined;
    const onKey = (e) => e.key === "Escape" && closeConnection();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [conn.open]);

  if (!conn.open) return null;

  const test = async () => {
    setPiUrl(url);
    if (isBlocked(url)) return setCheck({ bad: true, text: "Blocked: an https page can't reach an http address." });
    setCheck({ text: "Checking…" });
    try {
      const h = await getJSON("/api/health", { timeout: 3000 });
      setCheck({ ok: true, text: `Pi is up · hardware ${h.hw} · Arc ${h.arc?.enabled ? "on" : "off"} · Arkiv ${h.arkiv?.ok ? "ok" : "off"}` });
    } catch (e) {
      setCheck({ bad: true, text: `No answer from ${url}: ${e.name === "AbortError" ? "timed out" : e.message}` });
    }
  };

  const save = () => {
    setPiUrl(url);
    setAdminKey(key);
    closeConnection();
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
          Pi address
          <input
            className="mono bg-transparent text-sm font-bold text-ink outline-none"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://dynaura.local:8000"
            spellCheck={false}
            autoCapitalize="off"
          />
        </label>
        <label className="inner flex flex-col gap-1 p-3 text-xs text-muted">
          Committee admin key (only for admin actions, stays in this browser)
          <input
            className="mono bg-transparent text-sm font-bold text-ink outline-none"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="not set"
            autoComplete="off"
          />
        </label>
        {check && <span className={`text-xs ${check.bad ? "text-bad" : check.ok ? "text-good" : "text-muted"}`}>{check.text}</span>}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn-ghost" onClick={test}>
            Test the Pi
          </button>
          <button type="button" className="btn" onClick={save}>
            Save
          </button>
        </div>
        <span className="text-[11px] text-muted">Tip: a link with ?pi=http://dynaura.local:8000 sets the address too.</span>
      </div>
    </div>
  );
}
