/**
 * T18.1 browser E2E: the real local server and the bundled UI in a headless browser (the installed
 * pinned Playwright Chromium in CI, or installed Chrome/Edge locally). Skipped locally without a browser.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDefaultAnalyzerRegistry, type AnalyzerRegistry } from "@duo-director/analyzer";
import { createDecisionService, definitionRef, nodeId } from "@duo-director/core";
import { captureAdoptionBaseline } from "@duo-director/director";
import { indexRepository, openProjectGraphStore } from "@duo-director/graph";
import { LLMProviderPool, startDuoUiServer, type DuoUiServer } from "@duo-director/integration";
import { completeWorkTask, recordWorkReview, touchWorkTask } from "../../packages/integration/src/http/work-map.js";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });
const FIXTURES = fileURLToPath(new URL("../../fixtures/", import.meta.url));
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "Dev", GIT_AUTHOR_EMAIL: "dev@duo.invalid", GIT_COMMITTER_NAME: "Dev", GIT_COMMITTER_EMAIL: "dev@duo.invalid" };
const temps: string[] = [];
const servers: DuoUiServer[] = [];
let registry: AnalyzerRegistry;
let browser: Browser | undefined;

async function launch(): Promise<Browser | undefined> {
  if (process.env.CI !== undefined) {
    // CI installs the Playwright version's matching Chromium; absence is a test failure.
    return chromium.launch({ headless: true });
  }
  for (const channel of ["chrome", "msedge"]) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch {
      // try the next installed browser
    }
  }
  return undefined;
}

function repo(fixture: string, extra: (root: string) => void = () => {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "duo-ui-e2e-")));
  temps.push(root);
  fs.cpSync(path.join(FIXTURES, fixture), root, { recursive: true });
  extra(root);
  const git = (...a: string[]) => execFileSync("git", a, { cwd: root, env: gitEnv, windowsHide: true, stdio: "pipe" });
  git("-c", "init.defaultBranch=main", "init", "-q");
  git("config", "core.autocrlf", "false");
  git("add", "-A");
  git("commit", "-qm", "init");
  const index = async () => {
    const store = openProjectGraphStore(root).value;
    if (store === undefined) throw new Error("graph");
    try { await indexRepository(root, { store, registry }); } finally { store.close(); }
  };
  const write = (f: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), text); };
  const edit = (f: string, from: string, to: string) => write(f, fs.readFileSync(path.join(root, f), "utf8").replace(from, to));
  return { root, git, index, write, edit };
}

async function open(root: string): Promise<{ page: Page; server: DuoUiServer; foreign: string[]; errors: string[] }> {
  const server = await startDuoUiServer({ root, version: "e2e", registry, llm: new LLMProviderPool({}) });
  servers.push(server);
  const page = await (browser as Browser).newPage();
  const foreign: string[] = [];
  const errors: string[] = [];
  page.on("request", (r) => { if (!r.url().startsWith(server.origin)) foreign.push(r.url()); });
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(server.launchUrl);
  return { page, server, foreign, errors };
}

const see = (page: Page, text: string | RegExp) => page.getByText(text).first().waitFor({ timeout: 30_000 });
const nav = (page: Page, name: string) => page.getByRole("navigation").getByRole("link", { name, exact: true }).click();

beforeAll(async () => {
  const created = await createDefaultAnalyzerRegistry();
  if (created.value === undefined) throw new Error("registry");
  registry = created.value;
  browser = await launch();
});
afterAll(async () => {
  await browser?.close();
  for (const s of servers) await s.close();
  registry?.dispose();
  temps.forEach((t) => fs.rmSync(t, { recursive: true, force: true }));
});

describe("DUO UI in a browser (T18.1)", () => {
  it("renders the work map from compact DUO graph data", async (ctx) => {
    if (browser === undefined) return ctx.skip();
    const r = repo("review/app");
    await r.index();
    const { page, server, errors } = await open(r.root);
    await page.goto(`${server.origin}/work`);
    await page.getByRole("heading", { name: "Work map", level: 1 }).waitFor();
    await page.getByLabel("Work name").fill("Refresh flow");
    await page.getByLabel("DUO Issue ID (optional)").fill("AUTH-7");
    await page.getByRole("button", { name: "Add work" }).click();
    await page.getByText("[Codex] Refresh flow").first().waitFor();
    await page.locator(".react-flow__node").filter({ hasText: "[Codex] Refresh flow" }).click();
    await page.getByRole("button", { name: "Mark completed" }).waitFor();
    const nodes = page.locator(".react-flow__node");
    const count = await nodes.count();
    expect(count).toBeGreaterThan(1);
    expect(await page.getByText("Loading…").count()).toBe(0);
    expect(errors).toEqual([]);
  });

  it("shows live agent work, review, file changes and completion without refreshing", async (ctx) => {
    if (browser === undefined) return ctx.skip();
    const liveUpdateTimeoutMs = 30_000;
    const r = repo("review/app");
    await r.index();
    const { page, server, errors } = await open(r.root);
    const mapResponses: { at: number; revision: string | undefined; review: unknown; durationMs: number | undefined }[] = [];
    const revisionResponses: { at: number; revision: string | undefined; durationMs: number | undefined }[] = [];
    page.on("response", async (response) => {
      const endpoint = new URL(response.url()).pathname;
      if (!response.ok() || (endpoint !== "/api/work-map" && endpoint !== "/api/work-revision")) return;
      const result = await response.json().catch(() => undefined) as
        { data?: { revision?: string; nodes?: { type: string; review?: unknown }[] }; meta?: { durationMs?: number } } | undefined;
      if (result === undefined) return;
      if (endpoint === "/api/work-map") mapResponses.push({ at: Date.now(), revision: result.data?.revision,
        review: result.data?.nodes?.find((n) => n.type === "task")?.review, durationMs: result.meta?.durationMs });
      else revisionResponses.push({ at: Date.now(), revision: result.data?.revision, durationMs: result.meta?.durationMs });
    });
    await page.goto(`${server.origin}/work`);
    await see(page, "Add a work item to explore its DUO neighbourhood.");
    const session = "live-graph-session";
    const name = "Live graph probe";
    const targetRef = nodeId(definitionRef("issue", "AUTH-7"));
    const timings: Record<string, number> = {};
    const start = Date.now();
    const task = touchWorkTask(r.root, "Codex", name, new Date(), { duoSessionId: session, targetRef });
    expect(task).toBeDefined();
    const node = page.locator(".react-flow__node").filter({ hasText: `[Codex] ${name}` });
    try { await node.waitFor({ timeout: liveUpdateTimeoutMs }); }
    catch (error) {
      const currentMap = await page.evaluate("fetch('/api/work-map').then(r => r.json()).then(r => r.data)") as { nodes?: { type: string; label: string }[] };
      console.log(`WORK_MAP_TASK_DEBUG ${JSON.stringify({ mapResponses, revisionResponses,
        serverTask: currentMap.nodes?.find((n) => n.type === "task"), page: await page.locator(".work-page").textContent(), errors })}`);
      throw error;
    }
    timings.taskVisibleMs = Date.now() - start;
    await node.click();
    await page.locator(".work-detail").getByRole("heading", { name: `[Codex] ${name}` }).waitFor();
    expect(await page.locator(".work-detail").textContent()).toContain(targetRef);
    await page.evaluate(`(() => {
      const blankMs = [];
      let absentAt;
      const observer = new MutationObserver(() => {
        const present = document.querySelector(".react-flow__node") !== null;
        if (!present && absentAt === undefined) absentAt = performance.now();
        else if (present && absentAt !== undefined) { blankMs.push(performance.now() - absentAt); absentAt = undefined; }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      window.workGraphProbe = { blankMs, observer };
    })()`);

    const reviewStart = Date.now();
    recordWorkReview(r.root, session, name, { digest: "live-graph-review", verdict: "ASK", claimCount: 2 }, new Date());
    try { await page.getByText("Review ASK · 2 claims").waitFor({ timeout: liveUpdateTimeoutMs }); }
    catch (error) {
      const currentMap = await page.evaluate("fetch('/api/work-map').then(r => r.json()).then(r => r.data)") as { nodes?: { type: string; review?: unknown }[] };
      const stored = JSON.parse(fs.readFileSync(path.join(r.root, ".duo-project/runtime/work-tasks.json"), "utf8")) as { tasks: { review?: unknown }[] };
      console.log(`WORK_MAP_REVIEW_DEBUG ${JSON.stringify({ mapResponses, revisionResponses,
        detail: await page.locator(".work-detail").textContent(), storedReview: stored.tasks[0]?.review,
        serverReview: currentMap.nodes?.find((n) => n.type === "task")?.review, errors })}`);
      throw error;
    }
    timings.reviewVisibleMs = Date.now() - reviewStart;

    const fileStart = Date.now();
    r.write("live-graph-probe.txt", "changed while the page is open\n");
    await page.locator(".react-flow__node").filter({ hasText: "live-graph-probe.txt" }).waitFor({ timeout: liveUpdateTimeoutMs });
    await page.getByText("Index stale").waitFor({ timeout: liveUpdateTimeoutMs });
    timings.fileVisibleMs = Date.now() - fileStart;
    const blankMs = await page.evaluate(`(() => {
      window.workGraphProbe?.observer.disconnect();
      return window.workGraphProbe?.blankMs ?? [];
    })()`) as number[];

    const completeStart = Date.now();
    completeWorkTask(r.root, task?.id ?? "", new Date());
    await node.waitFor({ state: "detached", timeout: liveUpdateTimeoutMs });
    timings.completedVisibleMs = Date.now() - completeStart;
    expect(mapResponses.length).toBeGreaterThanOrEqual(4);
    expect(Math.max(0, ...blankMs)).toBeLessThan(500);
    expect(errors).toEqual([]);
    console.log(`WORK_MAP_LIVE_METRICS ${JSON.stringify({ ...timings, blankMs, mapResponses: mapResponses.length,
      revisionResponses: revisionResponses.length,
      maxMapDurationMs: Math.max(...mapResponses.map((r) => r.durationMs ?? 0)),
      maxRevisionDurationMs: Math.max(...revisionResponses.map((r) => r.durationMs ?? 0)) })}`);
  });

  it("overview, direction, context, review, confirm and reject, stale index and a deep link", async (ctx) => {
    if (browser === undefined) return ctx.skip();
    const r = repo("review/app");
    const service = createDecisionService({ root: r.root });
    const agent = { kind: "agent" as const, name: "codex" };
    const pa = (await service.propose(agent, { title: "Round reports half up", question: "report_rounding", answer: "round half up", governs: { requirements: ["RPT-01"] } })).value?.proposalId ?? "";
    const pb = (await service.propose(agent, { title: "Reports in cents", question: "report_unit", answer: "whole cents" })).value?.proposalId ?? "";
    await r.index(); // proposals are Project Truth files: index after writing them
    const { page, server, foreign, errors } = await open(r.root);

    await page.waitForURL(`${server.origin}/overview`);
    await page.getByRole("heading", { name: "Overview", level: 1 }).waitFor();
    await see(page, "review-app");
    await see(page, "index current");
    await see(page, "LLM disabled (default): DUO works without it");
    expect(await page.getByRole("alert").count()).toBe(0);

    await nav(page, "Direction");
    await page.getByRole("link", { name: "RPT-01", exact: true }).first().waitFor();
    const d010 = page.getByRole("row").filter({ hasText: "D-010" }).first();
    expect(await d010.textContent()).toContain("CONFIRMED");

    await nav(page, "Context");
    await page.getByLabel("Task").fill("RPT-01");
    await page.getByRole("button", { name: "Compile context" }).click();
    await see(page, "status: ready");
    await see(page, "Packet tokens");

    await nav(page, "Review");
    await page.getByRole("button", { name: "Review changes" }).click();
    await see(page, "Deterministic review:");
    await see(page, "This review is not recorded");

    await nav(page, "Pending decisions");
    const card = page.getByRole("article").filter({ hasText: pa });
    await card.getByRole("button", { name: "Confirm…" }).click();
    const dialog = page.getByRole("dialog", { name: `Confirm ${pa}?` });
    await dialog.waitFor();
    expect(await dialog.getByRole("button", { name: `Confirm ${pa}` }).isDisabled()).toBe(true);
    await dialog.getByRole("textbox").fill(pa);
    await dialog.getByRole("button", { name: `Confirm ${pa}` }).click();
    await see(page, new RegExp(`${pa} confirmed as D-\\d+`, "u"));
    const decisionId = /confirmed as (D-\d+)/u.exec((await page.getByRole("status").filter({ hasText: "confirmed as" }).first().textContent()) ?? "")?.[1] ?? "";
    await page.reload();
    await page.getByRole("heading", { name: "Pending decisions", level: 1 }).waitFor();
    // Read back from the server: the confirmed proposal left the pending list (its file is removed on commit).
    await page.getByRole("article").filter({ hasText: pb }).waitFor();
    expect(await page.getByRole("article").filter({ hasText: pa }).count()).toBe(0);

    await page.getByRole("article").filter({ hasText: pb }).getByRole("button", { name: "Reject…" }).click();
    const reject = page.getByRole("dialog", { name: `Reject ${pb}?` });
    await reject.getByLabel("Reason (optional)").fill("not now");
    await reject.getByRole("button", { name: `Reject ${pb}` }).click();
    await see(page, `${pb} rejected.`);
    await page.getByRole("heading", { name: "Pending decisions", level: 1 }).waitFor();
    expect(await page.getByRole("article").count()).toBe(0);
    await see(page, "No proposal is waiting for a human.");

    await nav(page, "Direction");
    const confirmedRow = page.getByRole("row").filter({ hasText: decisionId }).first();
    await confirmedRow.waitFor();
    expect(await confirmedRow.textContent()).toContain("CONFIRMED");

    // Stale index: the UI never indexes; the CLI (here: the indexer) does, and a Refresh shows it.
    r.edit("src/report/build-report.ts", "Math.floor(cents / 100)", "Math.round(cents / 100)");
    await nav(page, "Overview");
    await see(page, /Index required \(stale\)/u);
    await nav(page, "Context");
    await page.getByLabel("Task").fill("RPT-01");
    await page.getByRole("button", { name: "Compile context" }).click();
    await see(page, "index-required");
    await nav(page, "Review");
    await page.getByRole("button", { name: "Review changes" }).click();
    await see(page, "index-required");
    await r.index();
    await nav(page, "Overview");
    await page.getByRole("button", { name: "Refresh" }).click();
    await see(page, "index current");
    await nav(page, "Context");
    await page.getByLabel("Task").fill("RPT-01");
    await page.getByRole("button", { name: "Compile context" }).click();
    await see(page, "status: ready");

    // A deep link survives a refresh (the session is a cookie, not a URL fragment).
    await page.goto(`${server.origin}/entity/RPT-01`);
    await page.reload();
    await page.getByRole("heading", { name: "RPT-01", level: 1 }).waitFor();
    await see(page, "Definition source");

    expect(foreign).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("existing project: pre-existing and introduced violations look different", async (ctx) => {
    if (browser === undefined) return ctx.skip();
    const legacy = "export class LegacySessionStore {\n  save(token: string): string {\n    return token;\n  }\n}\n";
    const r = repo("review/app", (root) => fs.writeFileSync(path.join(root, "src", "auth", "legacy-session-store.ts"), legacy));
    await r.index();
    const store = openProjectGraphStore(r.root).value;
    if (store === undefined) throw new Error("graph");
    try {
      const captured = await captureAdoptionBaseline(r.root, { graph: store, registry, actor: { kind: "human", name: "Ada" } });
      expect(captured.value?.status).toBe("captured");
    } finally {
      store.close();
    }
    r.edit("src/auth/legacy-session-store.ts", "return token;", "return token.trim();");
    r.write("src/auth/server-session-store.ts", "export class ServerSessionStore {\n  keep(token: string): string {\n    return token;\n  }\n}\n");
    await r.index();
    const { page, errors } = await open(r.root);
    await nav(page, "Review");
    await page.getByLabel("Task (optional)").fill("AUTH-03");
    await page.getByRole("button", { name: "Review changes" }).click();
    await see(page, "Deterministic review:");
    const touched = page.getByRole("row").filter({ hasText: "in-adoption-baseline, touched" }).first();
    await touched.waitFor();
    expect(await touched.textContent()).not.toContain("blocking");
    const introduced = page.getByRole("row").filter({ hasText: "not-in-adoption-baseline" }).first();
    await introduced.waitFor();
    expect(await introduced.textContent()).toContain("blocking");
    expect(errors).toEqual([]);
  });

  it("polyglot coverage: TS L2, Java/C#/C++/Python L1, other files L0 file-level; LLM unavailable is plain state", async (ctx) => {
    if (browser === undefined) return ctx.skip();
    const r = repo("languages/polyglot", (root) => {
      fs.mkdirSync(path.join(root, ".duo-project"), { recursive: true });
      fs.writeFileSync(path.join(root, ".duo-project", "project.yaml"), "schema_version: 1\nname: storefront\nllm:\n  provider: openai-responses\n  model: gpt-test-model\n");
      fs.mkdirSync(path.join(root, "rules"), { recursive: true });
      fs.writeFileSync(path.join(root, "rules", "pricing.foo"), "rule discount\nend\n");
    });
    await r.index();
    const { page, errors } = await open(r.root);
    await see(page, "Semantic assistance unavailable · OPENAI_API_KEY is not set");
    expect(await page.getByRole("alert").count()).toBe(0);
    await nav(page, "Analysis coverage");
    const row = async (language: string) => (await page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: language, exact: true }) }).first().textContent()) ?? "";
    await page.getByRole("rowheader", { name: "typescript" }).waitFor();
    expect(await row("typescript")).toContain("L2 · partial semantics");
    for (const l of ["java", "csharp", "cpp", "python"]) expect(await row(l), l).toContain("L1 · structural");
    expect(await row("other files")).toContain("L0 · file-level analysis");
    expect(await row("other files")).toContain(".foo 1");
    expect(errors).toEqual([]);
  });
});
