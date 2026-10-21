/** Provider-reported usage only. Cached input and reasoning are subsets, never added twice. */
export function readEvents(text) {
  const events = [];
  for (const line of text.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { /* An interrupted final line is not usage. */ }
  }
  return events;
}

export function usageMetrics(events) {
  const turns = events.filter((event) => event.type === "turn.completed");
  const complete = turns.length > 0 && turns.every((event) =>
    Number.isFinite(event.usage?.input_tokens) && Number.isFinite(event.usage?.output_tokens));
  const input = complete ? turns.reduce((sum, event) => sum + event.usage.input_tokens, 0) : null;
  const output = complete ? turns.reduce((sum, event) => sum + event.usage.output_tokens, 0) : null;
  const hasCache = complete && turns.every((event) => Number.isFinite(event.usage.cached_input_tokens));
  const cached = hasCache ? turns.reduce((sum, event) => sum + event.usage.cached_input_tokens, 0) : null;
  const items = new Map();
  for (const event of events) if (event.type === "item.completed" && event.item?.id !== undefined) items.set(event.item.id, event.item);
  const completedItems = [...items.values()];
  const commands = completedItems.filter((item) => item.type === "command_execution");
  const mcp = completedItems.filter((item) => item.type === "mcp_tool_call");
  const duo = mcp.filter((item) => item.server === "duo" || item.tool?.startsWith("duo_"));
  return { source: "codex.turn.completed.usage", complete, inputTokens: input, outputTokens: output,
    totalTokens: complete ? input + output : null, cachedInputTokens: cached,
    uncachedInputTokens: input === null || cached === null ? null : input - cached,
    commandCalls: commands.length, mcpCalls: mcp.length, duoCalls: duo.length,
    duoTools: duo.map((item) => ({ tool: item.tool, status: item.status })),
    otherToolsUsed: completedItems.filter((item) => ["web_search", "collab_tool_call"].includes(item.type)).length,
    failedTurns: events.filter((event) => event.type === "turn.failed" || event.type === "error").length };
}

const median = (values) => { const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; };

export function compareRuns(runs) {
  const pairs = [1, 2, 3].map((pair) => {
    const a = runs.find((run) => run.id === `A${pair}`);
    const b = runs.find((run) => run.id === `B${pair}`);
    const eligible = a?.success === true && b?.success === true && a.metrics?.complete && b.metrics?.complete;
    return { pair, eligible: Boolean(eligible), reductionPercent: eligible && a.metrics.totalTokens > 0
      ? (a.metrics.totalTokens - b.metrics.totalTokens) / a.metrics.totalTokens * 100 : null };
  });
  const values = pairs.flatMap((pair) => pair.reductionPercent === null ? [] : [pair.reductionPercent]);
  return { pairs, validPairs: values.length, medianReductionPercent: values.length ? median(values) : null,
    minReductionPercent: values.length ? Math.min(...values) : null, maxReductionPercent: values.length ? Math.max(...values) : null,
    successes: { A: runs.filter((run) => run.arm === "A" && run.success).length, B: runs.filter((run) => run.arm === "B" && run.success).length } };
}
