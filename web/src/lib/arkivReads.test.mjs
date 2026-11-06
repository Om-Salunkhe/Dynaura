// Offline: keyless reads fail fast once Arkiv's free budget is spent (429 ANON_COST_LIMITED).
// Run: node --test src/lib/arkivReads.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { ArkivBudgetError, withBackoff } from "./arkivReads.js";

// What viem throws for that 429: an HttpRequestError whose details carry the body's error field.
const budget429 = () => Object.assign(new Error("HTTP request failed."), { status: 429, details: '"ANON_COST_LIMITED"' });

test("ANON_COST_LIMITED fails at once, then pauses further reads without calling the node", async () => {
  let calls = 0;
  const t0 = Date.now();
  await assert.rejects(withBackoff(async () => { calls++; throw budget429(); }), ArkivBudgetError);
  assert.equal(calls, 1, "no retries against a spent budget");
  assert.ok(Date.now() - t0 < 200, "no backoff wait");
  await assert.rejects(withBackoff(async () => { calls++; return "ok"; }), ArkivBudgetError);
  assert.equal(calls, 1, "the next read within a minute doesn't hit the node");
});
