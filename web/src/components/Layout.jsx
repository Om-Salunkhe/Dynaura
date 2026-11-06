import { Outlet, useLocation } from "react-router-dom";
import { useLive } from "../lib/api.js";
import { useArkivBusy } from "../lib/arkiv.js";
import BottomNav from "./BottomNav.jsx";
import { ConnectionBar, ConnectionDialog, MixedContentBanner } from "./Connection.jsx";
import OfflineBanner, { SafeStopBanner, isOffline } from "./OfflineBanner.jsx";
import TopNav from "./TopNav.jsx";

// Dashboards use the full desktop width; the other pages stay a readable column.
const WIDE = new Set(["/home", "/admin"]);

export default function Layout({ nav }) {
  const { pathname } = useLocation();
  const live = useLive();
  const arkiv = useArkivBusy(); // Arkiv's public endpoint is out of queries: say so once, quietly
  return (
    <div className="ambient min-h-screen">
      <TopNav items={nav} />
      <main
        className={`mx-auto w-full min-w-0 max-w-md px-4 pb-28 pt-5 sm:px-5 lg:px-8 lg:pb-12 lg:pt-7 ${
          WIDE.has(pathname) ? "lg:max-w-[1344px]" : "lg:max-w-3xl"
        }`}
      >
        <ConnectionBar />
        {arkiv.busy && (
          <div role="status" className="mb-3 flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-[11.5px] text-muted">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sun" />
            {arkiv.text}
          </div>
        )}
        <MixedContentBanner />
        {isOffline(live) && <OfflineBanner />}
        <SafeStopBanner live={live} />
        <Outlet />
      </main>
      <BottomNav items={nav} />
      <ConnectionDialog />
    </div>
  );
}
