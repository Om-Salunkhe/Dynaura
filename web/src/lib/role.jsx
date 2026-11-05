import { createContext, useContext, useEffect, useState } from "react";

const KEY = "dynaura.role";
const RoleContext = createContext(null);

export const FLATS = {
  A: { id: "A", name: "Flat A", floor: "Ground floor", short: "Ground" },
  B: { id: "B", name: "Flat B", floor: "1st floor", short: "1st" },
  C: { id: "C", name: "Flat C", floor: "2nd floor", short: "2nd" },
};

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    if (v?.role) return v;
  } catch {}
  return { role: "resident", flat: "A" };
}

/** Demo login: pick resident (and flat), admin or cleaner. Real sign-in comes later. */
export function RoleProvider({ children }) {
  const [who, setWho] = useState(load);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(who));
    } catch {}
  }, [who]);
  return <RoleContext.Provider value={[who, setWho]}>{children}</RoleContext.Provider>;
}

export function useRole() {
  return useContext(RoleContext);
}
