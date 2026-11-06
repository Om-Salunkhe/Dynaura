// Loaded (lazily) when the Twin design is switched on: the twin tokens and IBM Plex,
// with the fonts loaded without blocking the first paint.
import "./theme.css";

const FONTS =
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Devanagari:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap";

if (typeof document !== "undefined" && !document.getElementById("twin-fonts")) {
  const link = document.createElement("link");
  link.id = "twin-fonts";
  link.rel = "stylesheet";
  link.href = FONTS;
  link.media = "print"; // non-blocking; switched on once it has loaded
  link.onload = () => (link.media = "all");
  document.head.appendChild(link);
}
