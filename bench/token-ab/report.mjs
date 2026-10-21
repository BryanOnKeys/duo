#!/usr/bin/env node
/** Rebuild the final report from immutable provider traces after all six sessions finish. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { readEvents, usageMetrics, compareRuns } from "./metrics.mjs";

const out = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("usage: node bench/token-ab/report.mjs <experiment-output-directory>");
if (fs.existsSync(path.join(out, "invalidated.json"))) throw new Error("Invalid experiment: do not publish efficiency comparisons from these attempts");
const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
const preflight = JSON.parse(fs.readFileSync(path.join(out, "preflight.json"), "utf8"));
if (!preflight.referencePassed || !preflight.inputBuildPassed || !preflight.negativeFailed) throw new Error("Preflight gates did not all pass");
const excludedAttemptsFile = path.join(out, "excluded-attempts.json");
const excludedAttempts = fs.existsSync(excludedAttemptsFile) ? JSON.parse(fs.readFileSync(excludedAttemptsFile, "utf8")) : null;
const inputVerification = manifest.order.map((id) => ({ id, ...JSON.parse(fs.readFileSync(path.join(out, "setup", `${id}-input.json`), "utf8")) }));
if (inputVerification.some((input) => !input.matched || input.tree !== inputVerification[0].tree)) throw new Error("Measured inputs are not identical");
const observedToolTypes = new Set(["command_execution", "file_change", "mcp_tool_call", "web_search", "collab_tool_call", "todo_list"]);
const runs = manifest.order.map((id) => {
  const result = JSON.parse(fs.readFileSync(path.join(out, id, "result.json"), "utf8"));
  const events = readEvents(fs.readFileSync(path.join(out, id, "events.stdout"), "utf8"));
  const observedTools = new Map();
  for (const event of events) if (["item.started", "item.completed"].includes(event.type) && event.item?.id && observedToolTypes.has(event.item.type))
    observedTools.set(event.item.id, event.item);
  const metrics = usageMetrics(events);
  if (metrics.totalTokens !== result.metrics.totalTokens) throw new Error(`Raw usage and stored result disagree for ${id}`);
  return { ...result, metrics: { ...metrics, observedToolCalls: observedTools.size,
    fileChangeCalls: [...observedTools.values()].filter((item) => item.type === "file_change").length } };
});
const comparison = compareRuns(runs);
const calibration = fs.readdirSync(path.join(out, "preflight"))
  .filter((file) => /^(?:calibration|duo-calibration(?:-\d+)?)\.stdout$/u.test(file))
  .map((file) => ({ file, ...usageMetrics(readEvents(fs.readFileSync(path.join(out, "preflight", file), "utf8"))) }));
const n = (value) => value === null || value === undefined ? "unknown" : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
const summary = { format: "duo.token-ab-summary/1", model: manifest.model, reasoning: manifest.reasoning, runs, comparison, calibration, inputVerification, excludedAttempts,
  reportSha256: crypto.createHash("sha256").update(fs.readFileSync(new URL(import.meta.url))).digest("hex"),
  limitations: ["One historical SDD-heavy task, three pairs; no general or statistical efficacy claim.",
    "Provider cache uncontrolled; cached input reported separately and never double counted.",
    "Fresh DUO initialization has draft project intent and no manually added Requirement/Decision mappings.",
    "Setup, calibration, external grading and controller conversation are outside the six measured sessions.",
    "Workspace boundaries are instructions, not an OS-level read-isolation guarantee."] };
fs.writeFileSync(path.join(out, "summary.json"), JSON.stringify(summary));
const lines = ["# ssafesta token A/B — S15P21A604-911", "", `Model: ${manifest.model}; reasoning: ${manifest.reasoning}. Six independent sessions, no agent retries.`, "",
  "| Run | Result | Input | Cached input (subset) | Output | Total | Uncached input | Seconds | Observed tools | Commands | DUO |",
  "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...runs.map((r) => `| ${r.id} | ${r.success ? "PASS" : "FAIL"} | ${n(r.metrics.inputTokens)} | ${n(r.metrics.cachedInputTokens)} | ${n(r.metrics.outputTokens)} | ${n(r.metrics.totalTokens)} | ${n(r.metrics.uncachedInputTokens)} | ${n(r.execution.seconds)} | ${r.metrics.observedToolCalls} | ${r.metrics.commandCalls} | ${r.metrics.duoCalls} |`), "",
  "## Paired comparison", "", "| Pair | Both eligible | Total-token reduction |", "|---|---|---:|",
  ...comparison.pairs.map((p) => `| ${p.pair} | ${p.eligible ? "yes" : "no"} | ${p.eligible ? `${n(p.reductionPercent)}%` : "excluded"} |`), "",
  `Success: A ${comparison.successes.A}/3, B ${comparison.successes.B}/3. Valid pairs: ${comparison.validPairs}/3.`,
  `Median reduction: ${n(comparison.medianReductionPercent)}%; range ${n(comparison.minReductionPercent)}% to ${n(comparison.maxReductionPercent)}%.`, "",
  "Positive means DUO used fewer tokens; negative means DUO used more. Both runs must pass with measured usage and treatment compliance.", "",
  "## Verification", "",
  ...runs.map((r) => `- ${r.id}: acceptance=${r.verification.test.exitCode}, lint=${r.verification.lint.exitCode}, build=${r.verification.build.exitCode}, treatment=${r.treatmentCompliant}, changed files=${r.changedFiles}, setup=${n(r.setupSeconds)}s.`), "",
  "## Excluded earlier attempts", "",
  ...(excludedAttempts ? [`${excludedAttempts.experiment}: ${excludedAttempts.reason}`, "The attempt log is preserved separately and is not included in the paired comparison.",
    ...excludedAttempts.runs.map((r) => `- ${r.id}: ${r.outcome}, usage=${n(r.totalTokens)}, seconds=${n(r.seconds)}, DUO calls=${r.duoCalls}; ${r.reason}`)] : ["None."]), "",
  "## Excluded calibration", "", ...calibration.map((c) => `- ${c.file}: ${n(c.totalTokens)} provider tokens.`), "",
  "## Limits", "", ...summary.limitations.map((line) => `- ${line}`), "",
  "Total = provider input + output. Cached input is already included in input; reasoning is already included in output. Missing usage is unknown, never estimated/zero.",
  "Observed tool count deduplicates started/completed event IDs and includes file edits and plan tools. Raw traces are authoritative.", ""];
fs.writeFileSync(path.join(out, "summary.md"), lines.join("\n"));
console.log(JSON.stringify({ comparison, runs: runs.map((r) => ({ id: r.id, success: r.success, totalTokens: r.metrics.totalTokens,
  cachedInputTokens: r.metrics.cachedInputTokens, outputTokens: r.metrics.outputTokens, observedToolCalls: r.metrics.observedToolCalls })) }));
