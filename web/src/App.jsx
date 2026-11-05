import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import { RoleProvider, useRole } from "./lib/role.jsx";
import { useTheme } from "./lib/theme.js";
import AdminOverview from "./pages/AdminOverview.jsx";
import AdminTrading from "./pages/AdminTrading.jsx";
import Bill from "./pages/Bill.jsx";
import Building from "./pages/Building.jsx";
import CleanerJobs from "./pages/CleanerJobs.jsx";
import History from "./pages/History.jsx";
import Home from "./pages/Home.jsx";
import PanelHealth from "./pages/PanelHealth.jsx";
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
};

const HOME = { resident: "/", admin: "/admin", cleaner: "/jobs" };

function Routed() {
  const [who] = useRole();
  return (
    <Routes>
      <Route element={<Layout nav={NAV[who.role]} />}>
        <Route path="/" element={who.role === "resident" ? <Home /> : <Navigate to={HOME[who.role]} replace />} />
        <Route path="/society" element={<Society />} />
        <Route path="/building" element={<Building />} />
        <Route path="/bill" element={<Bill />} />
        <Route path="/history" element={<History />} />
        <Route path="/admin" element={<AdminOverview />} />
        <Route path="/admin/trading" element={<AdminTrading />} />
        <Route path="/admin/panel" element={<PanelHealth />} />
        <Route path="/jobs" element={<CleanerJobs />} />
        <Route path="*" element={<Navigate to={HOME[who.role]} replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  useTheme();
  return (
    <RoleProvider>
      <BrowserRouter>
        <Routed />
      </BrowserRouter>
    </RoleProvider>
  );
}
