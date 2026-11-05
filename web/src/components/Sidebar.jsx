import { NavLink } from "react-router-dom";
import { useRole } from "../lib/role.jsx";
import Icon from "./Icon.jsx";

/** Desktop navigation (1024px and wider). Phones use BottomNav. */
export default function Sidebar({ items }) {
  const [who] = useRole();
  const link = ({ isActive }) =>
    `flex min-h-[44px] items-center gap-3 rounded-2xl px-3 text-sm font-semibold ${
      isActive ? "bg-btn text-btn-ink" : "text-muted hover:bg-inner hover:text-ink"
    }`;

  return (
    <aside className="sticky top-6 hidden h-[calc(100vh-48px)] w-60 flex-none flex-col gap-2 rounded-[28px] border border-line bg-card p-4 backdrop-blur-xl lg:flex">
      <div className="flex items-center gap-2 px-2 pb-4 pt-1">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sun-soft text-sun-ink">
          <Icon name="sun" />
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-lg font-extrabold">Dynaura</span>
          <span className="text-[11px] text-muted">Sunrise Apartments</span>
        </span>
      </div>
      {items.map((it) => (
        <NavLink key={it.to} to={it.to} end={it.end ?? it.to === "/"} className={link}>
          <Icon name={it.icon} />
          {it.label}
        </NavLink>
      ))}
      {who.role === "resident" && (
        <NavLink to="/ask" className={link}>
          <Icon name="spark" />
          Ask Dyna
        </NavLink>
      )}
      <div className="mt-auto rounded-2xl bg-inner p-3 text-[11px] leading-relaxed text-muted">
        0G decides, Arc pays, Arkiv remembers.
      </div>
    </aside>
  );
}
