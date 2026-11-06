import { useLive } from "../lib/api.js";
import { useRole } from "../lib/role.jsx";
import Frame, { w } from "./Frame.jsx";

export default function TwinHome() {
  const live = useLive();
  const [who] = useRole();
  const f = who.flat || "A";
  return (
    <Frame
      screen="Home"
      rows={[
        ["source", live.demo ? "demo" : "live"],
        [`flat ${f} now`, w(live.meters?.[f]?.w)],
        [`flat ${f} on`, live.flats?.[f]?.source],
        ["roof panel", w(live.meters?.panel?.w)],
        ["building uses", w(live.used_w)],
      ]}
    />
  );
}
