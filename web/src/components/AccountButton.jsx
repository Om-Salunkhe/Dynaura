import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { openConnection } from "../lib/connection.js";
import { FLATS, useRole } from "../lib/role.jsx";
import { useTheme } from "../lib/theme.js";
import Icon from "./Icon.jsx";

const ROLES = [
  { role: "resident", flat: "A", label: "Resident · Flat A", home: "/" },
  { role: "resident", flat: "B", label: "Resident · Flat B", home: "/" },
  { role: "resident", flat: "C", label: "Resident · Flat C", home: "/" },
  { role: "admin", label: "Committee admin", home: "/admin" },
  { role: "cleaner", label: "Cleaner · Ravi", home: "/jobs" },
  { role: "shop", label: "Shop · Corner grocery", home: "/shop" },
];

/** Round button in the header: switch role (demo login) and theme. */
export default function AccountButton() {
  const [open, setOpen] = useState(false);
  const [who, setWho] = useRole();
  const [theme, toggleTheme] = useTheme();
  const go = useNavigate();

  const current = who.role === "resident" ? FLATS[who.flat].name : { admin: "Admin", cleaner: "Cleaner", shop: "Shop" }[who.role];

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`Account: ${current}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-card-solid text-ink"
      >
        <Icon name="user" size={18} />
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-30 w-60 rounded-2xl border border-line bg-card-solid p-2 shadow-nav">
          <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-muted">Sign in as</p>
          {ROLES.map((r) => {
            const active = r.role === who.role && (r.role !== "resident" || r.flat === who.flat);
            return (
              <button
                key={r.label}
                type="button"
                onClick={() => {
                  setWho({ role: r.role, flat: r.flat ?? who.flat });
                  setOpen(false);
                  go(r.home);
                }}
                className={`flex min-h-[44px] w-full items-center justify-between rounded-xl px-3 text-left text-sm font-semibold ${
                  active ? "bg-inner" : "hover:bg-inner"
                }`}
              >
                {r.label}
                {active && <Icon name="check" size={16} />}
              </button>
            );
          })}
          <div className="my-1 h-px bg-line" />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              openConnection();
            }}
            className="flex min-h-[44px] w-full items-center gap-2 rounded-xl px-3 text-sm font-semibold hover:bg-inner"
          >
            <Icon name="lock" size={16} />
            Connection & admin key
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            className="flex min-h-[44px] w-full items-center gap-2 rounded-xl px-3 text-sm font-semibold hover:bg-inner"
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
            {theme === "dark" ? "Light glass" : "Black glass"}
          </button>
        </div>
      )}
    </div>
  );
}
