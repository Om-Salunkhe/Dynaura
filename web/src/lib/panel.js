// The roof panel as the app shows it: its voltage is the headline (it rises with the sun / lamp),
// the watts the Pi counts from it are the small print.
export const panelVolts = (live) => {
  const v = live?.meters?.panel?.v;
  return v == null ? "–" : Number(v).toFixed(2);
};

export const panelWatts = (live) => {
  const w = Number(live?.meters?.panel?.w ?? 0);
  return w.toFixed(w < 0.1 ? 3 : 2);
};
