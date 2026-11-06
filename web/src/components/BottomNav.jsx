import { NavLink } from "react-router-dom";
import Icon from "./Icon.jsx";

/** Phone navigation: a plain tab bar pinned to the bottom edge. */
export default function BottomNav({ items }) {
  if (items.length < 2) return null;
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 grid border-t border-line bg-nav pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
          end={it.end ?? it.to === "/"}
          className={({ isActive }) =>
            `relative flex h-[58px] flex-col items-center justify-center gap-1 text-[10.5px] font-medium ${
              isActive
                ? "text-ink before:absolute before:left-1/2 before:top-0 before:h-[2px] before:w-6 before:-translate-x-1/2 before:rounded-full before:bg-sun"
                : "text-muted"
            }`
          }
        >
          <Icon name={it.icon} size={19} />
          {it.label}
        </NavLink>
      ))}
    </nav>
  );
}
