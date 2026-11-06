// Offline check that the verifier rebuilds the Pi's Python strings exactly.
// Vectors were produced by Python's json/hashlib with the Pi's own formulas (pi/signer.py,
// pi/cleaning.py). Run: node --test src/lib/arkivProof.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { proofHash, pyFloat, readingMessage, verifyReading } from "./arkivProof.js";

const FLOATS = [[0,"0.0"],[3,"3.0"],[1.25,"1.25"],[0.000208,"0.000208"],[0.00001,"1e-05"],[0.000015,"1.5e-05"],[0.0001,"0.0001"],[123456,"123456.0"],[10000000000000000,"1e+16"],[2.5e-7,"2.5e-07"],[0.30000000000000004,"0.30000000000000004"],[1.2346,"1.2346"],[0.000012,"1.2e-05"]];
const [ROW, MESSAGE] = [{"minute":1793907300,"meter":"panel","avg_w":0.000208,"wh":0.000003,"solar_wh":0.000003,"samples":60,"sig":"0x0303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303"},"dynaura:{\"avg_w\":0.000208,\"meter\":\"panel\",\"minute\":1793907300,\"samples\":60,\"solar_wh\":3e-06,\"wh\":3e-06}"];
const PROOF = {"rows":[{"minute":1793907480,"meter":"panel","avg_w":0,"wh":0,"solar_wh":0,"samples":60,"sig":"0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"},{"minute":1793907420,"meter":"panel","avg_w":3,"wh":0.05,"solar_wh":0.04918,"samples":60,"sig":"0x0101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101"},{"minute":1793907360,"meter":"panel","avg_w":1.25,"wh":0.020833,"solar_wh":0.020492,"samples":60,"sig":"0x0202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202"}],"hash":"0x05a90e2bb8cc8db07b32575631a4bae0acf6726489df552e1f6c2b215b92ce5f"};
const js = (r) => ({ minute: r.minute, meter: r.meter, avgW: r.avg_w, wh: r.wh, solarWh: r.solar_wh, samples: r.samples, sig: r.sig });

test("numbers print like Python's repr(float)", () => {
  for (const [x, py] of FLOATS) assert.equal(pyFloat(x), py, String(x));
});

test("the signed message matches pi/signer.py byte for byte", () => {
  assert.equal(readingMessage(js(ROW)), MESSAGE);
});

test("the proof hash matches pi/cleaning.py", () => {
  assert.equal(proofHash(PROOF.rows.map(js)), PROOF.hash);
});

test("a signature over that message recovers its signer", async () => {
  const device = privateKeyToAccount("0x" + "11".repeat(32));
  const r = { ...js(ROW) };
  r.sig = await device.signMessage({ message: readingMessage(r) });
  assert.equal((await verifyReading(r, device.address)).ok, true);
  assert.equal((await verifyReading({ ...r, avgW: r.avgW + 1 }, device.address)).ok, false);
});
