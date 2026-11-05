import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import { useTheme } from "./lib/theme.js";
import Bill from "./pages/Bill.jsx";
import Building from "./pages/Building.jsx";
import History from "./pages/History.jsx";
import Home from "./pages/Home.jsx";
import Society from "./pages/Society.jsx";

const RESIDENT_NAV = [
  { to: "/", label: "Home", icon: "home" },
  { to: "/society", label: "Society", icon: "society" },
  { to: "/building", label: "Building", icon: "bolt" },
  { to: "/bill", label: "Bill", icon: "bill" },
  { to: "/history", label: "History", icon: "clock" },
];

export default function App() {
  useTheme();
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout nav={RESIDENT_NAV} />}>
          <Route path="/" element={<Home />} />
          <Route path="/society" element={<Society />} />
          <Route path="/building" element={<Building />} />
          <Route path="/bill" element={<Bill />} />
          <Route path="/history" element={<History />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
