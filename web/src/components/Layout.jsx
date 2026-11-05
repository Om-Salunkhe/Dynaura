import { Outlet, useLocation } from "react-router-dom";
import BottomNav from "./BottomNav.jsx";
import Sidebar from "./Sidebar.jsx";

// Dashboards use the full desktop width; the other pages stay a readable column.
const WIDE = new Set(["/", "/admin"]);

export default function Layout({ nav }) {
  const { pathname } = useLocation();
  return (
    <div className="flex min-h-screen gap-6 px-5 pb-32 pt-6 lg:px-6 lg:pb-6">
      <Sidebar items={nav} />
      <main className={`mx-auto w-full max-w-md ${WIDE.has(pathname) ? "lg:max-w-none" : "lg:max-w-3xl"}`}>
        <Outlet />
      </main>
      <BottomNav items={nav} />
    </div>
  );
}
