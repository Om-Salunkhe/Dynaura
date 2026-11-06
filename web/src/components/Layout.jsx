import { Outlet, useLocation } from "react-router-dom";
import { useLive } from "../lib/api.js";
import { useDesign } from "../lib/design.js";
import BottomNav from "./BottomNav.jsx";
import { ConnectionBar, ConnectionDialog, MixedContentBanner } from "./Connection.jsx";
import OfflineBanner, { SafeStopBanner, isOffline } from "./OfflineBanner.jsx";
import Sidebar from "./Sidebar.jsx";

// Dashboards use the full desktop width; the other pages stay a readable column.
const WIDE = new Set(["/", "/admin"]);
const TWIN_WIDE = new Set(["/admin/panel"]); // the twin's panel page has two columns on desktop

export default function Layout({ nav }) {
  const { pathname } = useLocation();
  const live = useLive();
  const wide = WIDE.has(pathname) || (useDesign() === "twin" && TWIN_WIDE.has(pathname));
  return (
    <div className="flex min-h-screen gap-6 px-5 pb-32 pt-6 lg:px-6 lg:pb-6">
      <Sidebar items={nav} />
      <main className={`mx-auto w-full max-w-md ${wide ? "lg:max-w-none" : "lg:max-w-3xl"}`}>
        <ConnectionBar />
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
