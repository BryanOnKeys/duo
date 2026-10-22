/**
 * BE-API-05 (T95): GET /api/proposals/{id}/preview over a real UI server. The preview is DecisionService's
 * previewConfirm: the digest must equal the one /api/proposals shows and must be accepted by confirm, a changed
 * Truth must change it, and reading it must change nothing on disk.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createDefaultAnalyzerRegistry, type AnalyzerRegistry } from "@duo-director/analyzer";
import { createDecisionService } from "@duo-director/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LLMProviderPool } from "../llm/factory.js";
import { startDuoUiServer, type DuoUiServer } from "./server.js";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });
const env = { ...process.env, GIT_AUTHOR_NAME: "Dev", GIT_AUTHOR_EMAIL: "dev@duo.invalid", GIT_COMMITTER_NAME: "Dev", GIT_COMMITTER_EMAIL: "dev@duo.invalid" };
const temps: string[] = [];
const servers: DuoUiServer[] = [];
let registry: AnalyzerRegistry;
let assets: string;
const human = { kind: "human" as const, name: "Ada" };
const agent = { kind: "agent" as const, name: "codex" };

interface Client { readonly root: string; readonly server: DuoUiServer; readonly cookie: string; readonly csrf: string }
interface Res { readonly status: number; readonly headers: http.IncomingHttpHeaders; readonly body: string; json(): { format: string; ok: boolean; data: Record<string, unknown>; error?: { code: string } } }

function send(c: Pick<Client, "server">, method: string, target: string, headers: Record<string, string> = {}, body?: string): Promise<Res> {
  return new Promise((resolve, reject) => {
    // Do not reuse a keep-alive socket from the previous server run when testing restart on the same port.
    const req = http.request({ agent: false, host: "127.0.0.1", port: c.server.port, method, path: target, headers: { Host: "127.0.0.1:" + String(c.server.port), ...headers } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (x: string) => { text += x; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text, json: () => JSON.parse(text) }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
const get = (c: Client, target: string) => send(c, "GET", target, { Cookie: c.cookie });
const post = (c: Client, target: string, body: unknown) => send(c, "POST", target, { Cookie: c.cookie, Origin: c.server.origin, "Content-Type": "application/json", "X-Duo-CSRF": c.csrf }, JSON.stringify(body));

function repo(files: Record<string, string>): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "duo-api05-")));
  temps.push(root);
  for (const [f, t] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), t);
  }
  return root;
}
const git = (root: string, ...a: string[]) => execFileSync("git", a, { cwd: root, env, windowsHide: true, stdio: "pipe" }).toString();
function commit(root: string) {
  if (!fs.existsSync(path.join(root, ".git"))) {
    git(root, "-c", "init.defaultBranch=main", "init", "-q");
    git(root, "config", "core.autocrlf", "false");
  }
  git(root, "add", "-A");
  git(root, "commit", "-qm", "state");
}

async function serve(root: string, port?: number): Promise<Client> {
  const server = await startDuoUiServer({ root, version: "test", registry, llm: new LLMProviderPool({}), assetsDir: assets, ...(port === undefined ? {} : { port }) });
  servers.push(server);
  const launch = new URL(server.launchUrl);
  const opened = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const req = http.request({ agent: false, host: "127.0.0.1", port: server.port, method: "GET", path: launch.pathname + launch.search, headers: { Host: "127.0.0.1:" + String(server.port) } }, resolve);
    req.on("error", reject);
    req.end();
  });
  opened.resume();
  const cookie = String(opened.headers["set-cookie"]?.[0] ?? "").split(";")[0] ?? "";
  const partial = { root, server, cookie, csrf: "" };
  const csrf = String((await get(partial, "/api/session")).json().data.csrf);
  return { ...partial, csrf };
}

function snapshot(root: string): [string, string][] {
  const dir = path.join(root, ".duo-project");
  return fs.readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => !/^runtime([\\/]|$)/u.test(f) && fs.statSync(path.join(dir, f)).isFile())
    .sort().map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8")]);
}

const PROJECT = { ".duo-project/project.yaml": "schema_version: 1\nname: api05\n", ".duo-project/specs/core.md": "# Core\n\n## REQ-001 Storage\n\n```duo\ntype: requirement\nstatus: planned\n```\n\nStore data.\n" };

let c: Client;

beforeAll(async () => {
  const created = await createDefaultAnalyzerRegistry();
  if (created.value === undefined) throw new Error("registry");
  registry = created.value;
  assets = fs.mkdtempSync(path.join(os.tmpdir(), "duo-api05-assets-"));
  temps.push(assets);
  fs.writeFileSync(path.join(assets, "index.html"), "<!doctype html><div id=\"root\"></div>");
  const root = repo(PROJECT);
  const service = createDecisionService({ root });
  const p1 = await service.propose(agent, { title: "Use Postgres", question: "database", answer: "postgres" });
  if (p1.value === undefined || (await service.confirm(human, p1.value.proposalId)).value === undefined) throw new Error("setup P-001");
  const p2 = await service.propose(agent, { title: "Use SQLite", question: "database", answer: "sqlite", supersedes: "D-001" });
  const p3 = await service.propose(agent, { title: "Use Redis", question: "cache", answer: "redis" });
  if (p2.value === undefined || p3.value === undefined) throw new Error("setup P-002, P-003");
  if ((await service.reject(human, p3.value.proposalId, "not now")).value === undefined) throw new Error("setup reject");
  commit(root);
  c = await serve(root);
});

afterAll(async () => {
  for (const s of servers) await s.close();
  registry?.dispose();
  temps.forEach((t) => fs.rmSync(t, { recursive: true, force: true }));
});

type Preview = { sourceId: string; sourceKind: string; action: string; digest: string; expectedDecisionId: string; supersedes?: { id: string }; candidate: Record<string, unknown>; proposedBy?: string; proposedByKind?: string };
const preview = async (id: string) => {
  const r = await get(c, "/api/proposals/" + id + "/preview");
  expect(r.status, r.body).toBe(200);
  expect(r.json().format).toBe("duo.ui.preview/1");
  return r.json().data as { status: string; preview?: Preview; warnings?: unknown[]; diagnostics?: { code: string; message: string }[] };
};

// BE-API-10: exercise the actual HTTP middleware with a valid pending proposal/digest.
// Domain cases (IDs, proposal states, digest changes, successful confirm) stay in the existing tests below.
function expectSecurityFailure(r: Res, status: number, code: string, client: Client = c) {
  expect(r.status, r.body).toBe(status);
  expect(r.json()).toMatchObject({ format: "duo.ui.error/1", ok: false, error: { code } });
  expect(r.json()).not.toHaveProperty("data");
  expect(r.headers["cache-control"]).toBe("no-store");
  expect(r.headers["access-control-allow-origin"]).toBeUndefined();
  for (const secret of [client.root, client.root.replaceAll("\\", "/"), client.cookie, client.csrf]) {
    expect(r.body).not.toContain(secret);
  }
}

describe("Preview and Confirm request security (BE-API-10)", () => {
  it.each(["foreign host", "wrong port", "forged session"])("preview rejects %s without changing Truth", async (scenario) => {
    const before = snapshot(c.root);
    const headers: Record<string, string> = { Cookie: c.cookie };
    if (scenario === "foreign host") headers.Host = "evil.example";
    if (scenario === "wrong port") headers.Host = "127.0.0.1:0";
    if (scenario === "forged session") headers.Cookie = c.cookie.replace(/=.*/u, "=forged");
    const r = await send(c, "GET", "/api/proposals/P-002/preview", headers);
    expectSecurityFailure(r, scenario === "forged session" ? 401 : 403, scenario === "forged session" ? "UI_SESSION_REQUIRED" : "UI_HOST_REJECTED");
    expect(snapshot(c.root)).toEqual(before);
  });

  it.each(["absent", "foreign"])("authenticated preview allows Origin=%s without CSRF and does not grant CORS", async (origin) => {
    const before = snapshot(c.root);
    const headers: Record<string, string> = { Cookie: c.cookie, Host: "localhost:" + String(c.server.port) };
    if (origin === "foreign") headers.Origin = "https://evil.example";
    const r = await send(c, "GET", "/api/proposals/P-002/preview", headers);
    expect(r.status).toBe(200);
    expect(r.json()).toMatchObject({ format: "duo.ui.preview/1", ok: true, data: { status: "ready", preview: { sourceId: "P-002" }, warnings: [] } });
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
    expect(snapshot(c.root)).toEqual(before);
  });

  it("does not disclose session credentials from /api/session without a session", async () => {
    expectSecurityFailure(await send(c, "GET", "/api/session"), 401, "UI_SESSION_REQUIRED");
  });

  it.each([
    ["missing CSRF", "UI_CSRF_REJECTED", 403],
    ["wrong CSRF", "UI_CSRF_REJECTED", 403],
    ["missing Origin", "UI_ORIGIN_REJECTED", 403],
    ["foreign Origin", "UI_ORIGIN_REJECTED", 403],
    ["foreign Host", "UI_HOST_REJECTED", 403],
    ["missing session", "UI_SESSION_REQUIRED", 401],
    ["forged session", "UI_SESSION_REQUIRED", 401],
  ] as const)("confirm rejects %s without creating a Decision or changing the proposal", async (scenario, code, status) => {
    const digest = (await preview("P-002")).preview?.digest;
    expect(digest).toMatch(/^sha256:/u);
    const before = snapshot(c.root);
    const headers: Record<string, string> = { Cookie: c.cookie, Origin: c.server.origin, "Content-Type": "application/json", "X-Duo-CSRF": c.csrf };
    if (scenario === "missing CSRF") delete headers["X-Duo-CSRF"];
    if (scenario === "wrong CSRF") headers["X-Duo-CSRF"] = "forged";
    if (scenario === "missing Origin") delete headers.Origin;
    if (scenario === "foreign Origin") headers.Origin = "https://evil.example";
    if (scenario === "foreign Host") headers.Host = "evil.example";
    if (scenario === "missing session") delete headers.Cookie;
    if (scenario === "forged session") headers.Cookie = c.cookie.replace(/=.*/u, "=forged");
    const r = await send(c, "POST", "/api/proposals/P-002/confirm", headers, JSON.stringify({ confirmId: "P-002", previewDigest: digest }));
    expectSecurityFailure(r, status, code);
    expect(snapshot(c.root)).toEqual(before);
    expect(fs.existsSync(path.join(c.root, ".duo-project/decisions/D-002.yaml"))).toBe(false);
    expect((await preview("P-002")).preview?.digest).toBe(digest);
    expect(git(c.root, "status", "--porcelain")).toBe("");
  });

  it("restarting on the same port invalidates the old cookie, launch link and CSRF token", async () => {
    const root = repo(PROJECT);
    const proposal = await createDecisionService({ root }).propose(agent, { title: "Use SQLite", question: "database", answer: "sqlite" });
    expect(proposal.value?.proposalId).toBe("P-001");
    commit(root);
    const old = await serve(root);
    expect((await get(old, "/api/proposals/P-001/preview")).json().data.status).toBe("ready");
    await old.server.close();
    servers.splice(servers.indexOf(old.server), 1);
    const fresh = await serve(root, old.server.port);
    const before = snapshot(root);
    const url = new URL(old.server.launchUrl);
    expectSecurityFailure(await send(fresh, "GET", url.pathname + url.search), 403, "UI_SESSION_REJECTED", old);
    expectSecurityFailure(await send(fresh, "GET", "/api/proposals/P-001/preview", { Cookie: old.cookie }), 401, "UI_SESSION_REQUIRED", old);
    expectSecurityFailure(await send(fresh, "GET", "/api/session", { Cookie: old.cookie }), 401, "UI_SESSION_REQUIRED", old);
    const current = await get(fresh, "/api/proposals/P-001/preview");
    expect(current.status).toBe(200);
    expect(current.json().data.status).toBe("ready");
    const digest = (current.json().data.preview as Preview).digest;
    const refused = await send(fresh, "POST", "/api/proposals/P-001/confirm", {
      Cookie: fresh.cookie, Origin: fresh.server.origin, "Content-Type": "application/json", "X-Duo-CSRF": old.csrf,
    }, JSON.stringify({ confirmId: "P-001", previewDigest: digest }));
    expectSecurityFailure(refused, 403, "UI_CSRF_REJECTED", fresh);
    expect(snapshot(root)).toEqual(before);
    expect(git(root, "status", "--porcelain")).toBe("");
  });
});

describe("GET /api/proposals/{id}/preview (BE-API-05)", () => {
  it("returns the previewConfirm result with the same digest as /api/proposals, and reading changes nothing", async () => {
    const before = snapshot(c.root);
    const one = await preview("P-002");
    expect(one.status).toBe("ready");
    expect(one.preview).toMatchObject({ sourceId: "P-002", sourceKind: "proposal", action: "create", expectedDecisionId: "D-002", supersedes: { id: "D-001" }, proposedBy: "codex", proposedByKind: "agent" });
    expect(one.preview?.candidate).toMatchObject({ title: "Use SQLite", answer: "sqlite", supersedes: "D-001" });
    const all = (await get(c, "/api/proposals")).json().data as { previews: Record<string, { digest?: string }> };
    expect(all.previews["P-002"]?.digest).toBe(one.preview?.digest);
    expect((await preview("P-002")).preview?.digest).toBe(one.preview?.digest);
    expect(snapshot(c.root)).toEqual(before);
    expect(git(c.root, "status", "--porcelain")).toBe("");
  });

  it("a changed proposal file changes the digest, and restoring the file restores it", async () => {
    const original = (await preview("P-002")).preview?.digest;
    const file = path.join(c.root, ".duo-project/decisions/proposals/P-002.yaml");
    const text = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, text.replace("answer: sqlite", "answer: duckdb"));
    const edited = await preview("P-002");
    expect(edited.preview?.candidate).toMatchObject({ answer: "duckdb" });
    expect(edited.preview?.digest).not.toBe(original);
    fs.writeFileSync(file, text);
    expect((await preview("P-002")).preview?.digest).toBe(original);
    expect(git(c.root, "status", "--porcelain")).toBe("");
  });


  it("a confirmed, rejected or unknown proposal fails with the service's code; a malformed ID, other methods and no session are refused", async () => {
    expect((await preview("P-001")).diagnostics?.map((d) => d.code)).toEqual(["PROPOSAL_NOT_PENDING"]);
    expect((await preview("P-003")).diagnostics?.map((d) => d.code)).toEqual(["PROPOSAL_NOT_PENDING"]);
    expect((await preview("P-099")).diagnostics?.map((d) => d.code)).toEqual(["PROPOSAL_NOT_FOUND"]);
    expect((await preview("P-abc")).diagnostics?.map((d) => d.code)).toEqual(["INVALID_ID"]);
    for (const p of ["/api/proposals/D-001/preview", "/api/proposals/P%20001/preview", "/api/proposals/%E0%A4%A/preview", "/api/proposals/..%2Fx/preview"]) {
      const r = await get(c, p);
      expect(r.status, p).toBe(400);
      expect(r.json().error?.code).toBe("UI_REQUEST_INVALID");
    }
    expect((await post(c, "/api/proposals/P-002/preview", {})).json().error?.code).toBe("UI_METHOD_NOT_ALLOWED");
    expect((await send(c, "GET", "/api/proposals/P-002/preview")).json().error?.code).toBe("UI_SESSION_REQUIRED");
  });

  it("a Truth change gives a new digest; confirm refuses the old digest without writing and accepts the new one", async () => {
    const old = (await preview("P-002")).preview?.digest ?? "";
    const spec = path.join(c.root, ".duo-project/specs/core.md");
    fs.writeFileSync(spec, fs.readFileSync(spec, "utf8").replace("Store data.", "Store data durably."));
    const fresh = await preview("P-002");
    expect(fresh.status).toBe("ready");
    expect(fresh.preview?.digest).not.toBe(old);
    const before = snapshot(c.root);
    const refused = (await post(c, "/api/proposals/P-002/confirm", { confirmId: "P-002", previewDigest: old })).json().data as { status: string; diagnostics: { code: string }[] };
    expect(refused.status).toBe("failed");
    expect(refused.diagnostics.map((d) => d.code)).toContain("DECISION_CONFIRM_PREVIEW_CHANGED");
    expect(snapshot(c.root)).toEqual(before);
    const done = (await post(c, "/api/proposals/P-002/confirm", { confirmId: "P-002", previewDigest: fresh.preview?.digest })).json().data as { status: string; result: { decisionId: string } };
    expect(done).toMatchObject({ status: "confirmed", result: { decisionId: "D-002" } });
    const afterConfirm = snapshot(c.root);
    const again = (await post(c, "/api/proposals/P-002/confirm", { confirmId: "P-002", previewDigest: fresh.preview?.digest })).json().data as { status: string; diagnostics: { code: string }[] };
    expect(again.status).toBe("failed");
    expect(again.diagnostics.map((d) => d.code)).toEqual(["PROPOSAL_NOT_PENDING"]);
    expect(snapshot(c.root)).toEqual(afterConfirm);
    expect((await preview("P-002")).diagnostics?.map((d) => d.code)).toEqual(["PROPOSAL_NOT_PENDING"]);
  });
});

describe("damaged or missing Truth (BE-API-05)", () => {
  it("damaged Truth fails like confirm would (PROJECT_TRUTH_INVALID) and shows no machine path", async () => {
    const root = repo(PROJECT);
    const service = createDecisionService({ root });
    if ((await service.propose(agent, { title: "Use Postgres", question: "database", answer: "postgres" })).value === undefined) throw new Error("setup");
    fs.writeFileSync(path.join(root, ".duo-project/decisions/D-001.yaml"), "id: D-001\ntitle: [unclosed\n");
    commit(root);
    const d = await serve(root);
    const before = snapshot(root);
    const r = await get(d, "/api/proposals/P-001/preview");
    const data = r.json().data as { status: string; diagnostics: { code: string }[] };
    expect(data.status).toBe("failed");
    expect(data.diagnostics.map((x) => x.code)).toContain("PROJECT_TRUTH_INVALID");
    expect(r.body).not.toContain(root);
    expect(r.body).not.toContain(root.replaceAll("\\", "/"));
    expect(snapshot(root)).toEqual(before);
  });

  it("a repository without DUO answers not-initialized", async () => {
    const root = repo({ "README.md": "# none\n" });
    commit(root);
    const d = await serve(root);
    expect((await get(d, "/api/proposals/P-001/preview")).json().data).toMatchObject({ status: "not-initialized" });
  });
});
