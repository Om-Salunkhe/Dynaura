import { useLive } from "../lib/api.js";
import { routingStory, usePlan } from "../lib/plan.js";
import Frame, { w } from "./Frame.jsx";

export default function TwinBuilding() {
  const live = useLive();
  const story = routingStory(live, usePlan(!live.demo));
  const flat = (f) => `${live.flats?.[f]?.away ? "away · " : ""}${live.flats?.[f]?.source ?? "–"} · ${w(live.meters?.[f]?.w) ?? "–"}`;
  return (
    <Frame
      screen="Building"
      rows={[
        ["roof panel", w(live.meters?.panel?.w)],
        ["flat C", flat("C")],
        ["flat B", flat("B")],
        ["flat A", flat("A")],
        ["pump", live.pump?.on ? "on" : "off"],
        ["routing", story.text],
        ["Dyna's reason", story.reason],
      ]}
    />
  );
}
