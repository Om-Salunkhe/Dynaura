/** @type {import('tailwindcss').Config} */
const v = (name) => `var(--${name})`;

export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        card: v("card"),
        "card-solid": v("card-solid"),
        inner: v("inner"),
        line: v("line"),
        ink: v("ink"),
        "ink-2": v("ink-2"),
        muted: v("muted"),
        idle: v("idle"),
        sun: v("sun"),
        "sun-ink": v("sun-ink"),
        "sun-soft": v("sun-soft"),
        grid: v("grid"),
        good: v("good"),
        bad: v("bad"),
        link: v("link"),
        btn: v("btn"),
        "btn-ink": v("btn-ink"),
        nav: v("nav"),
      },
      boxShadow: { nav: v("shadow") },
      fontFamily: {
        sans: ["Instrument Sans", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
