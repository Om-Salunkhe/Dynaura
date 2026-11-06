import { NavLink } from "react-router-dom";
import Icon from "./Icon.jsx";

/** Phone navigation: a floating glass tab bar. */
export default function BottomNav({ items }) {
  if (items.length < 2) return null;
  return (
    <nav
      aria-label="Main"
      className="glass fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-30 mx-auto grid h-[62px] max-w-[420px] gap-1 rounded-[22px] p-1.5 lg:hidden"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
          end={it.end ?? it.to === "/home"}
          className={({ isActive }) =>
            `flex flex-col items-center justify-center gap-[3px] rounded-[16px] text-[10.5px] font-medium transition-colors ${
              isActive ? "glass-pill text-ink" : "text-muted"
            }`
          }
        >
          <span className="relative">
            <Icon name={it.icon} size={19} />
            {it.dot && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-bad" aria-label="needs attention" />}
          </span>
          {it.label}
        </NavLink>
      ))}
    </nav>
  );
}
