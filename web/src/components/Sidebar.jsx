import { NavLink } from "react-router-dom";
import { useRole } from "../lib/role.jsx";
import Icon from "./Icon.jsx";

/** Desktop navigation (1024px and wider). Phones use BottomNav. */
export default function Sidebar({ items }) {
  const [who] = useRole();
  const link = ({ isActive }) =>
    `flex min-h-[44px] items-center gap-3 rounded-2xl px-4 text-[15px] font-semibold ${
      isActive ? "bg-btn font-extrabold text-btn-ink" : "text-ink-2 hover:bg-inner hover:text-ink"
    }`;

  return (
    <aside className="sticky top-6 hidden h-[calc(100vh-48px)] w-[220px] flex-none flex-col gap-1.5 rounded-[28px] border border-line bg-card p-4 backdrop-blur-xl lg:flex">
      <div className="flex items-center gap-3 px-2 pb-5 pt-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#111418] text-sun">
          <Icon name="sun" size={20} />
        </span>
        <span className="text-[22px] font-extrabold tracking-[-0.5px]">Dynaura</span>
      </div>
      {items.map((it) => (
        <NavLink key={it.to} to={it.to} end={it.end ?? it.to === "/"} className={link}>
          <Icon name={it.icon} size={18} />
          {it.label}
        </NavLink>
      ))}
      <div className="mt-auto flex flex-col gap-0.5 rounded-2xl bg-inner p-3.5">
        {who.role === "resident" ? (
          <>
            <span className="text-xs text-muted">Signed in with 0G</span>
            <span className="text-sm font-bold">flat-{who.flat.toLowerCase()}.dynaura.eth</span>
            <span className="text-xs font-bold text-sun-ink">42 iAI credits left</span>
          </>
        ) : (
          <>
            <span className="text-xs text-muted">Sunrise Apartments</span>
            <span className="text-sm font-bold">0G decides, Arc pays, Arkiv remembers.</span>
          </>
        )}
      </div>
    </aside>
  );
}
