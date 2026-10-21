import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDefaultAnalyzerRegistry } from "../../packages/analyzer/dist/index.js";
import { fileRef, nodeId } from "../../packages/core/dist/index.js";
import { completeWorkTask, projectWorkMap, touchWorkTask, workMapRevision } from "../../packages/integration/dist/http/work-map.js";

const workspace = fileURLToPath(new URL("../../", import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(workspace,
  "bench/results/local/token-ab/2026-10-20-daily-mission-v5/manifest.json"), "utf8"));
const root = fs.realpathSync(path.join(manifest.scratch, "B1"));
const registry = (await createDefaultAnalyzerRegistry()).value;
if (registry === undefined) throw new Error("analyzer registry unavailable");
const task = touchWorkTask(root, "Codex", "ssafesta map profile", new Date(), {
  duoSessionId: `map-profile-${Date.now()}`,
  targetRef: nodeId(fileRef("festa-frontend/src/features/mission/ui/DailyMissionOverlay.tsx")),
});
if (task === undefined) throw new Error("task unavailable");
const rows = [];
const timed = async (fn) => { const start = performance.now(); await fn(); return Math.round(performance.now() - start); };
try {
  for (let i = 0; i < 3; i++) rows.push({
    revisionMs: await timed(() => workMapRevision(root)),
    mapWithoutIndexCheckMs: await timed(() => projectWorkMap(root, task.id)),
    mapWithIndexCheckMs: await timed(() => projectWorkMap(root, task.id, { registry })),
  });
  console.log(JSON.stringify({ rows }));
} finally {
  completeWorkTask(root, task.id, new Date());
  registry.dispose();
}
