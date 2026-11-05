import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { dynaChat } from "../data/demo.js";
import { postJSON } from "../lib/api.js";
import { useRole } from "../lib/role.jsx";

const SUGGESTIONS = ["Best time to run the AC?", "Explain my bill", "Will tomorrow be sunny?"];

export default function AskDyna() {
  const go = useNavigate();
  const [who] = useRole();
  const [msgs, setMsgs] = useState(dynaChat);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  const ask = async (q) => {
    q = q.trim();
    if (!q || busy) return;
    setText("");
    setBusy(true);
    setMsgs((m) => [...m, { from: "me", text: q }]);
    try {
      const r = await postJSON("/api/ask", { question: q, flat: who.flat });
      setMsgs((m) => [...m, { from: "dyna", text: [r.answer], proof: r.proof }]);
    } catch {
      setMsgs((m) => [
        ...m,
        {
          from: "dyna",
          text: ["I can't reach the building right now, so this is a demo answer. Once 0G is connected I'll answer from your meter, bills and tomorrow's sun."],
          proof: "Demo · not sent to 0G",
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex h-[100dvh] max-w-md flex-col gap-4 px-5 pb-6 pt-5">
      <header className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Back"
          onClick={() => (window.history.length > 1 ? go(-1) : go("/"))}
          className="flex h-11 w-11 flex-none items-center justify-center rounded-full border border-line bg-card-solid"
        >
          <Icon name="back" size={18} stroke={2.2} />
        </button>
        <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[14px] bg-sun-soft text-sun-ink">
          <Icon name="spark" size={22} />
        </span>
        <span className="flex flex-1 flex-col gap-0.5">
          <span className="text-lg font-extrabold">Dyna</span>
          <span className="text-xs text-muted">Knows your meter, bills and the sun · 1 iAI per answer</span>
        </span>
      </header>

      <main className="flex flex-1 flex-col gap-3.5 overflow-y-auto">
        <span className="self-center text-[11px] text-muted">Today</span>
        {msgs.map((m, i) =>
          m.from === "me" ? (
            <div key={i} className="max-w-[78%] self-end rounded-[20px_20px_6px_20px] bg-btn px-3.5 py-3 text-sm font-semibold leading-snug text-btn-ink">
              {m.text}
            </div>
          ) : (
            <div key={i} className="flex max-w-[88%] flex-col gap-2.5 self-start rounded-[20px_20px_20px_6px] border border-line bg-card p-3.5">
              {m.text.map((t, k) => (
                <span key={k} className="text-sm leading-relaxed">
                  {t}
                </span>
              ))}
              {m.actions && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn">
                    {m.actions[0]}
                  </button>
                  <button type="button" className="btn-ghost">
                    {m.actions[1]}
                  </button>
                </div>
              )}
              {m.proof && <span className="mono text-[11px] text-muted">{m.proof}</span>}
            </div>
          )
        )}
        {busy && <span className="self-start text-sm text-muted">Dyna is thinking…</span>}
        <div ref={end} />
      </main>

      <div className="flex gap-2 overflow-x-auto">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => ask(s)}
            className="min-h-[44px] flex-none rounded-full border border-line bg-card-solid px-3.5 text-[13px] font-semibold"
          >
            {s}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(text);
        }}
        className="flex items-center gap-2 rounded-full border border-line bg-card-solid py-1.5 pl-[18px] pr-1.5"
      >
        <label htmlFor="ask" className="sr-only">
          Ask Dyna
        </label>
        <input
          id="ask"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask Dyna…"
          className="min-h-[44px] min-w-0 flex-1 bg-transparent text-[15px] outline-none"
        />
        <button type="submit" aria-label="Send" disabled={busy} className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-sun text-[#140600]">
          <Icon name="arrowUp" size={18} stroke={2.4} />
        </button>
      </form>
    </div>
  );
}
