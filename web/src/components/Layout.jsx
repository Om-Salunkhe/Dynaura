import { Outlet, useLocation } from "react-router-dom";
import { useLive } from "../lib/api.js";
import BottomNav from "./BottomNav.jsx";
import { ConnectionDialog, MixedContentBanner } from "./Connection.jsx";
import OfflineBanner, { SafeStopBanner, isOffline } from "./OfflineBanner.jsx";
import Sidebar from "./Sidebar.jsx";

// Dashboards use the full desktop width; the other pages stay a readable column.
const WIDE = new Set(["/", "/admin"]);

export default function Layout({ nav }) {
  const { pathname } = useLocation();
  const live = useLive();
  return (
    <div className="flex min-h-screen gap-6 px-5 pb-32 pt-6 lg:px-6 lg:pb-6">
      <Sidebar items={nav} />
      <main className={`mx-auto w-full max-w-md ${WIDE.has(pathname) ? "lg:max-w-none" : "lg:max-w-3xl"}`}>
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
