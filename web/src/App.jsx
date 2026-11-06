import { lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import Variant from "./components/Variant.jsx";
import { RoleProvider, useRole } from "./lib/role.jsx";
import { useTheme } from "./lib/theme.js";
import AdminOverview from "./pages/AdminOverview.jsx";
import AdminTrading from "./pages/AdminTrading.jsx";
import AskDyna from "./pages/AskDyna.jsx";
import Bill from "./pages/Bill.jsx";
import Building from "./pages/Building.jsx";
import CleanerJobs from "./pages/CleanerJobs.jsx";
import Demo from "./pages/Demo.jsx";
import History from "./pages/History.jsx";
import Home from "./pages/Home.jsx";
import PanelHealth from "./pages/PanelHealth.jsx";
import ShopOffers from "./pages/ShopOffers.jsx";
import Society from "./pages/Society.jsx";

const NAV = {
  resident: [
    { to: "/", label: "Home", icon: "home" },
    { to: "/society", label: "Society", icon: "society" },
    { to: "/building", label: "Building", icon: "bolt" },
    { to: "/bill", label: "Bill", icon: "bill" },
    { to: "/history", label: "History", icon: "clock" },
  ],
  admin: [
    { to: "/admin", label: "Overview", icon: "grid", end: true },
    { to: "/admin/trading", label: "Trading", icon: "trade" },
    { to: "/society", label: "Society", icon: "society" },
    { to: "/admin/panel", label: "Panel", icon: "panel" },
  ],
  cleaner: [{ to: "/jobs", label: "Jobs", icon: "broom" }],
  shop: [{ to: "/shop", label: "Offers", icon: "trade" }],
};

const HOME = { resident: "/", admin: "/admin", cleaner: "/jobs", shop: "/shop" };

// The Twin design (an option under review): loaded only when it's switched on
const Twin = {
  Home: lazy(() => import("./twin/Home.jsx")),
  Building: lazy(() => import("./twin/Building.jsx")),
  PanelHealth: lazy(() => import("./twin/PanelHealth.jsx")),
  CleanerJobs: lazy(() => import("./twin/CleanerJobs.jsx")),
  Demo: lazy(() => import("./twin/Demo.jsx")),
};

function Routed() {
  const [who] = useRole();
  return (
    <Routes>
      <Route path="/ask" element={<AskDyna />} />
      <Route path="/demo" element={<Variant current={Demo} twin={Twin.Demo} />} />
      <Route element={<Layout nav={NAV[who.role]} />}>
        <Route path="/" element={who.role === "resident" ? <Variant current={Home} twin={Twin.Home} /> : <Navigate to={HOME[who.role]} replace />} />
        <Route path="/society" element={<Society />} />
        <Route path="/building" element={<Variant current={Building} twin={Twin.Building} />} />
        <Route path="/bill" element={<Bill />} />
        <Route path="/history" element={<History />} />
        <Route path="/admin" element={<AdminOverview />} />
        <Route path="/admin/trading" element={<AdminTrading />} />
        <Route path="/admin/panel" element={<Variant current={PanelHealth} twin={Twin.PanelHealth} />} />
        <Route path="/jobs" element={<Variant current={CleanerJobs} twin={Twin.CleanerJobs} />} />
        <Route path="/shop" element={<ShopOffers />} />
        <Route path="*" element={<Navigate to={HOME[who.role]} replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  useTheme();
  return (
    <RoleProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routed />
      </BrowserRouter>
    </RoleProvider>
  );
}
