import { NavLink } from "react-router-dom";
import Icon from "./Icon.jsx";

export default function BottomNav({ items }) {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-4 bottom-5 z-20 mx-auto grid h-[68px] max-w-[398px] gap-1 rounded-[24px] border border-line bg-nav p-1.5 shadow-nav backdrop-blur-xl lg:hidden"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
          end={it.to === "/"}
          className={({ isActive }) =>
            `flex flex-col items-center justify-center gap-[3px] rounded-[18px] text-[11px] font-semibold ${
              isActive ? "bg-btn text-btn-ink shadow-lg" : "text-muted hover:text-ink"
            }`
          }
        >
          <Icon name={it.icon} />
          {it.label}
        </NavLink>
      ))}
    </nav>
  );
}
