import { Outlet } from "react-router-dom";
import BottomNav from "./BottomNav.jsx";

export default function Layout({ nav }) {
  return (
    <div className="mx-auto min-h-screen max-w-md px-5 pb-32 pt-6">
      <Outlet />
      <BottomNav items={nav} />
    </div>
  );
}
