// node --test bench/value-validation/measure.test.mjs
// Regression tests for the NOT MEASURED rule in the Value Validation 01 measurement helpers (PR #24 review).
import assert from "node:assert/strict";
import { test } from "node:test";
import { agentSummary, countMeasured, medianAll, parseEvents, sumAll } from "./measure.mjs";

const usage = (input, output, cached) => JSON.stringify({ type: "turn.completed", usage: { input_tokens: input, output_tokens: output, ...(cached === undefined ? {} : { cached_input_tokens: cached }) } });

test("a total or median with a missing run is null, and the measured count is reported", () => {
  assert.equal(sumAll([100, null, 100]), null);
  assert.equal(sumAll([100, undefined]), null);
  assert.equal(sumAll([]), null);
  assert.equal(sumAll([100, 0, 100]), 200);
  assert.equal(medianAll([3, null, 1]), null);
  assert.equal(medianAll([3, 1, 2]), 2);
  assert.equal(medianAll([4, 1, 3, 2]), 2);
  assert.equal(countMeasured([100, null, 100]), 2);
});

test("an event stream without a valid usage event has usage null, not zero", () => {
  assert.equal(parseEvents("").usage, null);
  const early = [JSON.stringify({ type: "thread.started" }), JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "hi" } })].join("\n");
  assert.equal(parseEvents(early).usage, null);
  assert.equal(parseEvents(JSON.stringify({ type: "turn.completed", usage: {} })).usage, null);
  assert.equal(parseEvents(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 5 } })).usage, null);
  assert.equal(parseEvents("not json\n{\"type\":").usage, null);
});

test("usage sums every valid turn; cached stays null unless reported; a real zero is kept", () => {
  assert.deepEqual(parseEvents([usage(10, 2, 4), usage(5, 1, 1)].join("\n")).usage, { input: 15, cached: 5, output: 3 });
  assert.deepEqual(parseEvents(usage(10, 2)).usage, { input: 10, cached: null, output: 2 });
  assert.deepEqual(parseEvents(usage(0, 0, 0)).usage, { input: 0, cached: 0, output: 0 });
  assert.equal(parseEvents([usage(10, 2, 4), "", "garbage"].join("\n")).turns, 1);
});

test("agentSummary marks a condition NOT MEASURED when one run lacks usage, and counts the measured runs", () => {
  const runs = [
    { condition: "A", status: "completed", wallSeconds: 10, usage: { input: 100, cached: 0, output: 10 }, events: { checkRuns: 1, reworkCycles: 0, proposals: 0 }, duo: { contextTokens: null } },
    { condition: "A", status: "failed", wallSeconds: 12, usage: null, events: { checkRuns: 0, reworkCycles: 0, proposals: 0 }, duo: { contextTokens: null } },
    { condition: "B", status: "completed", wallSeconds: 8, usage: { input: 50, cached: null, output: 5 }, events: { checkRuns: 2, reworkCycles: 1, proposals: 0 }, duo: { contextTokens: null } },
  ];
  const s = agentSummary(runs);
  assert.equal(s.A.inputTokens, null);
  assert.equal(s.A.measuredRuns.inputTokens, 1);
  assert.equal(s.A.totalWallSeconds, 22);
  assert.equal(s.A.checkRuns, 1);
  assert.equal(s.B.inputTokens, 50);
  assert.equal(s.B.cachedInputTokens, null);
  assert.equal(s.B.contextPacketTokens, null);
});
