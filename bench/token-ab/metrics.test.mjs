import assert from "node:assert/strict";
import { test } from "node:test";
import { compareRuns, readEvents, usageMetrics } from "./metrics.mjs";
import { agentEnvironment } from "./runtime.mjs";

test("usage ignores intermediate cumulative snapshots and never adds cached or reasoning tokens", () => {
  const events = readEvents(JSON.stringify({ type: "token_count", usage: { input_tokens: 900 } }) + "\n" +
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 70, output_tokens: 20,
      reasoning_tokens: 15 } }) + "\n{interrupted");
  const usage = usageMetrics(events);
  assert.equal(usage.totalTokens, 120); assert.equal(usage.uncachedInputTokens, 30); assert.equal(usage.complete, true);
});
test("a failed run with no completed turn has unknown usage, not zero", () => {
  const usage = usageMetrics([{ type: "turn.failed", error: { message: "timeout" } }]);
  assert.equal(usage.complete, false); assert.equal(usage.totalTokens, null);
});
test("failed cheap runs cannot count as savings", () => {
  const result = compareRuns([{ id: "A1", arm: "A", success: true, metrics: { complete: true, totalTokens: 100 } },
    { id: "B1", arm: "B", success: false, metrics: { complete: true, totalTokens: 1 } }]);
  assert.equal(result.validPairs, 0); assert.equal(result.medianReductionPercent, null);
});
test("Windows Path spelling survives adding a DUO executable directory", () => {
  const env = agentEnvironment({ Path: "original-bin", CODEX_THREAD_ID: "parent", CODEX_HOME: "auth-home" }, "duo-bin");
  assert.ok(env.Path.endsWith("original-bin")); assert.ok(env.Path.startsWith("duo-bin"));
  assert.equal(env.PATH, undefined); assert.equal(env.CODEX_THREAD_ID, undefined); assert.equal(env.CODEX_HOME, "auth-home");
});
test("uppercase PATH is preserved too, without mutating the host environment", () => {
  const original = { PATH: "original-bin" }; const env = agentEnvironment(original, "duo-bin");
  assert.ok(env.PATH.endsWith("original-bin")); assert.equal(original.PATH, "original-bin");
});
