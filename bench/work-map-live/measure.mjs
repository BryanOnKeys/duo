import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { fileRef, nodeId } from "../../packages/core/dist/index.js";
import { startDuoUiServer } from "../../packages/integration/dist/index.js";
import { completeWorkTask, recordWorkReview, touchWorkTask } from "../../packages/integration/dist/http/work-map.js";

const workspace = fileURLToPath(new URL("../../", import.meta.url));
const campaign = path.join(workspace, "bench/results/local/token-ab/2026-10-20-daily-mission-v5");
const manifest = JSON.parse(fs.readFileSync(path.join(campaign, "manifest.json"), "utf8"));
const root = fs.realpathSync(path.join(manifest.scratch, "B1"));
const output = path.join(workspace, "bench/results/local/work-map-live/ssafesta-b1.json");
const series = path.join(workspace, "bench/results/local/work-map-live/ssafesta-final.jsonl");
const probe = path.join(root, "duo-live-graph-probe.txt");
const sessionId = `live-graph-${Date.now()}`;
const name = "ssafesta graph live probe";
const targetRef = nodeId(fileRef("festa-frontend/src/features/mission/ui/DailyMissionOverlay.tsx"));
let browser;
let server;
let task;
let probeCreated = false;

try {
  server = await startDuoUiServer({ root, version: "live-measurement" });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  const errors = [];
  const responses = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", async (response) => {
    const endpoint = new URL(response.url()).pathname;
    if (endpoint !== "/api/work-map" && endpoint !== "/api/work-revision") return;
    const result = await response.json().catch(() => undefined);
    responses.push({ endpoint, status: response.status(), durationMs: result?.meta?.durationMs });
  });
  await page.goto(server.launchUrl);
  const initialStart = Date.now();
  await page.goto(`${server.origin}/work`);
  await page.getByRole("heading", { name: "Work map", level: 1 }).waitFor();
  await page.locator(".work-summary").waitFor({ timeout: 60_000 });
  const timings = { initialMapMs: Date.now() - initialStart };

  let started = Date.now();
  task = touchWorkTask(root, "Codex", name, new Date(), { duoSessionId: sessionId, targetRef });
  if (task === undefined) throw new Error("task was not recorded");
  const node = page.locator(".react-flow__node").filter({ hasText: `[Codex] ${name}` });
  await node.waitFor({ timeout: 30_000 });
  timings.taskVisibleMs = Date.now() - started;
  await node.click();
  await page.locator(".work-detail").getByRole("heading", { name: `[Codex] ${name}` }).waitFor();

  started = Date.now();
  recordWorkReview(root, sessionId, task?.id ?? "", { digest: "live-graph-probe", verdict: "ASK", claimCount: 1 }, new Date());
  await page.getByText("Review ASK · 1 claims").waitFor({ timeout: 30_000 });
  timings.reviewVisibleMs = Date.now() - started;

  started = Date.now();
  fs.writeFileSync(probe, "live graph probe\n");
  probeCreated = true;
  await page.locator(".react-flow__node").filter({ hasText: "duo-live-graph-probe.txt" }).waitFor({ timeout: 30_000 });
  timings.fileVisibleMs = Date.now() - started;
  await page.screenshot({ path: path.join(workspace, "bench/results/local/work-map-live/ssafesta-graph.png") });

  started = Date.now();
  completeWorkTask(root, task.id, new Date());
  await node.waitFor({ state: "detached", timeout: 30_000 });
  timings.completedVisibleMs = Date.now() - started;
  const result = { format: "duo.work-map-live/1", source: "ssafesta B1 token A/B scratch copy", timings,
    mapRequests: responses.filter((r) => r.endpoint === "/api/work-map").length,
    revisionRequests: responses.filter((r) => r.endpoint === "/api/work-revision").length,
    maxMapDurationMs: Math.max(...responses.filter((r) => r.endpoint === "/api/work-map").map((r) => r.durationMs ?? 0)),
    maxRevisionDurationMs: Math.max(...responses.filter((r) => r.endpoint === "/api/work-revision").map((r) => r.durationMs ?? 0)),
    httpErrors: responses.filter((r) => r.status !== 200), browserErrors: errors };
  fs.writeFileSync(output, JSON.stringify(result), "utf8");
  fs.appendFileSync(series, `${JSON.stringify(result)}\n`, "utf8");
  console.log(JSON.stringify(result));
  if (errors.length > 0 || result.httpErrors.length > 0) process.exitCode = 1;
} finally {
  if (task !== undefined) completeWorkTask(root, task.id, new Date());
  if (probeCreated) fs.rmSync(probe, { force: true });
  await browser?.close();
  await server?.close();
}
