import { NavLink } from "react-router-dom";
import { useRole } from "../lib/role.jsx";
import Icon from "./Icon.jsx";

/** Desktop navigation (1024px and wider). Phones use BottomNav. */
export default function Sidebar({ items }) {
  const [who] = useRole();
  const link = ({ isActive }) =>
    `relative flex h-9 items-center gap-2.5 rounded-lg px-3 text-[13.5px] transition-colors ${
      isActive
        ? "bg-inner font-medium text-ink before:absolute before:inset-y-2 before:left-0 before:w-[2px] before:rounded-full before:bg-sun"
        : "text-muted hover:bg-inner hover:text-ink"
    }`;

  return (
    <aside className="sticky top-0 hidden h-screen w-[232px] flex-none flex-col border-r border-line bg-card px-3 pb-3 pt-5 lg:flex">
      <div className="flex items-center gap-2.5 px-2 pb-6">
        <span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-gradient-to-br from-[#f7b955] to-[#e9860f] text-[#1a1206]">
          <Icon name="sun" size={16} stroke={2.2} />
        </span>
        <span className="text-[16px] font-semibold tracking-[-0.2px]">Dynaura</span>
      </div>
      <span className="px-3 pb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
        {who.role === "resident" ? "Flat" : who.role === "admin" ? "Committee" : "Workspace"}
      </span>
      <nav className="flex flex-col gap-0.5">
        {items.map((it) => (
          <NavLink key={it.to} to={it.to} end={it.end ?? it.to === "/"} className={link}>
            <Icon name={it.icon} size={16} />
            {it.label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-0.5 border-t border-line px-2 pt-3">
        {who.role === "resident" ? (
          <>
            <span className="text-[11px] text-muted">Signed in with 0G</span>
            <span className="mono truncate text-[12px] text-ink">flat-{who.flat.toLowerCase()}.dynaura.eth</span>
            <span className="text-[11px] text-sun-ink">42 iAI credits left</span>
          </>
        ) : (
          <>
            <span className="text-[11px] text-muted">Sunrise Apartments</span>
            <span className="text-[12px] text-ink-2">0G decides, Arc pays, Arkiv remembers.</span>
          </>
        )}
      </div>
    </aside>
  );
}
