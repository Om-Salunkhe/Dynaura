import { Outlet, useLocation } from "react-router-dom";
import { useLive } from "../lib/api.js";
import BottomNav from "./BottomNav.jsx";
import { ConnectionBar, ConnectionDialog, MixedContentBanner } from "./Connection.jsx";
import OfflineBanner, { SafeStopBanner, isOffline } from "./OfflineBanner.jsx";
import Sidebar from "./Sidebar.jsx";

// Dashboards use the full desktop width; the other pages stay a readable column.
const WIDE = new Set(["/", "/admin"]);

export default function Layout({ nav }) {
  const { pathname } = useLocation();
  const live = useLive();
  return (
    <div className="flex min-h-screen">
      <Sidebar items={nav} />
      <div className={`relative min-w-0 flex-1 ${pathname === "/" ? "wash" : ""}`}>
        <main
          className={`mx-auto w-full min-w-0 max-w-md px-4 pb-28 pt-5 sm:px-5 lg:px-8 lg:pb-10 lg:pt-7 ${
            WIDE.has(pathname) ? "lg:max-w-[1280px]" : "lg:max-w-3xl"
          }`}
        >
          <ConnectionBar />
          <MixedContentBanner />
          {isOffline(live) && <OfflineBanner />}
          <SafeStopBanner live={live} />
          <Outlet />
        </main>
      </div>
      <BottomNav items={nav} />
      <ConnectionDialog />
    </div>
  );
}
