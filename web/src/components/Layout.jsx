import { Outlet } from "react-router-dom";
import BottomNav from "./BottomNav.jsx";
import Sidebar from "./Sidebar.jsx";

export default function Layout({ nav }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-6xl gap-8 px-5 pb-32 pt-6 lg:px-8 lg:pb-10">
      <Sidebar items={nav} />
      <main className="mx-auto w-full max-w-md lg:max-w-2xl">
        <Outlet />
      </main>
      <BottomNav items={nav} />
    </div>
  );
}
