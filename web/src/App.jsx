import { useTheme } from "./lib/theme.js";

export default function App() {
  const [theme, toggle] = useTheme();
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-3 p-5">
      <h1 className="h-title">Dynaura</h1>
      <section className="card">
        <p className="label">Theme</p>
        <p className="text-lg font-bold">{theme === "dark" ? "Black glass" : "Light glass"}</p>
        <button className="btn mt-3" onClick={toggle}>Switch theme</button>
      </section>
    </main>
  );
}
