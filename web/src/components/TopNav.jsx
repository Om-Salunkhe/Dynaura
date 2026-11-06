import { NavLink } from "react-router-dom";
import { useRole } from "../lib/role.jsx";
import AccountButton from "./AccountButton.jsx";
import Icon from "./Icon.jsx";

/** Desktop navigation (1024px and wider): a floating glass bar. Phones use BottomNav. */
export default function TopNav({ items }) {
  const [who] = useRole();
  const link = ({ isActive }) =>
    `flex h-8 items-center gap-2 rounded-full px-3 text-[13px] transition-colors ${
      isActive ? "glass-pill font-medium text-ink" : "text-muted hover:text-ink"
    }`;

  return (
    <div className="sticky top-3 z-30 hidden px-8 lg:block">
      <header className="glass mx-auto flex h-[50px] max-w-[1280px] items-center gap-4 rounded-[16px] pl-4 pr-1.5">
        <div className="flex flex-none items-center gap-2.5 pr-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-gradient-to-br from-[#f7b955] to-[#e9860f] text-[#1a1206] shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
            <Icon name="sun" size={16} stroke={2.2} />
          </span>
          <span className="text-[15.5px] font-medium tracking-[-0.2px]">Dynaura</span>
        </div>
        <nav aria-label="Main" className="flex flex-1 items-center justify-center gap-1">
          {items.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end ?? it.to === "/home"} className={link}>
              <span className="relative">
                <Icon name={it.icon} size={16} />
                {it.dot && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-bad" aria-label="needs attention" />}
              </span>
              {it.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex flex-none items-center gap-3">
          {who.role === "resident" ? (
            <span className="flex flex-col items-end leading-tight">
              <span className="mono text-[11.5px] text-ink-2">flat-{who.flat.toLowerCase()}.dynaura.eth</span>
              <span className="text-[11px] text-sun-ink">42 iAI credits</span>
            </span>
          ) : (
            <span className="text-[12px] text-muted">Sunrise Apartments</span>
          )}
          <AccountButton />
        </div>
      </header>
    </div>
  );
}
