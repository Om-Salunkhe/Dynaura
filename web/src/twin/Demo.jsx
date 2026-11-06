import { ConnectionDialog, ConnectionPill } from "../components/Connection.jsx";
import { isOffline } from "../components/OfflineBanner.jsx";
import { useLive } from "../lib/api.js";
import { useHero } from "../lib/hero.js";
import { MOMENTS, setScene, useScene } from "../lib/scene.js";
import Frame from "./Frame.jsx";

export default function TwinDemo() {
  const live = useLive();
  const scene = useScene();
  const hero = useHero(live);
  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col gap-4 p-8">
      <div className="flex items-center justify-between gap-3">
        <span className="flex gap-1.5">
          {MOMENTS.map((m) => (
            <button key={m.key} type="button" className={m.key === scene.moment ? "btn" : "btn-ghost"} onClick={() => setScene({ moment: m.key })}>
              {m.n} {m.short}
            </button>
          ))}
        </span>
        <ConnectionPill size="xl" />
      </div>
      <Frame
        screen="Projector (/demo)"
        header={false}
        rows={[
          ["moment", scene.moment],
          ["0G", isOffline(live) ? "offline (no AI)" : "online"],
          ["hero stage", hero.stage],
          ["panel", hero.pct != null ? `${Math.round(hero.pct)}%` : null],
        ]}
      />
      <ConnectionDialog />
    </div>
  );
}
