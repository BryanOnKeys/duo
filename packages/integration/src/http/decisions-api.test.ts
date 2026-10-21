/**
 * BE-API-02 (T95): GET /api/decisions and GET /api/decisions/{id} over a real UI server. The Decisions are made
 * through DecisionService (propose → confirm → supersede) plus one hand-written manual Decision, and a second
 * repository holds damaged Truth. Every request is a GET; the tests check that nothing on disk changes.
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
interface Res { readonly status: number; readonly body: string; json(): { format: string; ok: boolean; data: Record<string, unknown>; error?: { code: string } } }

function send(c: Pick<Client, "server">, method: string, target: string, headers: Record<string, string> = {}, body?: string): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: c.server.port, method, path: target, headers: { Host: "127.0.0.1:" + String(c.server.port), ...headers } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (x: string) => { text += x; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text, json: () => JSON.parse(text) }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
const get = (c: Client, target: string) => send(c, "GET", target, { Cookie: c.cookie });

function repo(files: Record<string, string>): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "duo-api02-")));
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

async function serve(root: string): Promise<Client> {
  const server = await startDuoUiServer({ root, version: "test", registry, llm: new LLMProviderPool({}), assetsDir: assets });
  servers.push(server);
  const launch = new URL(server.launchUrl);
  const opened = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: server.port, method: "GET", path: launch.pathname + launch.search, headers: { Host: "127.0.0.1:" + String(server.port) } }, resolve);
    req.on("error", reject);
    req.end();
  });
  opened.resume();
  const cookie = String(opened.headers["set-cookie"]?.[0] ?? "").split(";")[0] ?? "";
  const partial = { root, server, cookie, csrf: "" };
  const csrf = String((await get(partial, "/api/session")).json().data.csrf);
  return { ...partial, csrf };
}

/** Every file under .duo-project/ except runtime/ (metrics and locks), path → content. */
function snapshot(root: string): [string, string][] {
  const dir = path.join(root, ".duo-project");
  return fs.readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => !/^runtime([\\/]|$)/u.test(f) && fs.statSync(path.join(dir, f)).isFile())
    .sort().map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8")]);
}

const PROJECT = { ".duo-project/project.yaml": "schema_version: 1\nname: api02\n" };
const MANUAL = ["id: D-003", "title: Manual decision", "state: confirmed", "question: manual", "answer: written by hand", ""].join("\n");

let good: Client;

beforeAll(async () => {
  const created = await createDefaultAnalyzerRegistry();
  if (created.value === undefined) throw new Error("registry");
  registry = created.value;
  assets = fs.mkdtempSync(path.join(os.tmpdir(), "duo-api02-assets-"));
  temps.push(assets);
  fs.writeFileSync(path.join(assets, "index.html"), "<!doctype html><div id=\"root\"></div>");

  const root = repo(PROJECT);
  const service = createDecisionService({ root });
  const p1 = await service.propose(agent, { title: "Use Postgres", question: "database", answer: "postgres" });
  if (p1.value === undefined) throw new Error(JSON.stringify(p1.diagnostics));
  if ((await service.confirm(human, p1.value.proposalId)).value === undefined) throw new Error("confirm D-001");
  const p2 = await service.propose(agent, { title: "Use SQLite", question: "database", answer: "sqlite", supersedes: "D-001" });
  if (p2.value === undefined) throw new Error(JSON.stringify(p2.diagnostics));
  const c2 = await service.confirm(human, p2.value.proposalId);
  if (c2.value === undefined) throw new Error(JSON.stringify(c2.diagnostics));
  fs.writeFileSync(path.join(root, ".duo-project/decisions/D-003.yaml"), MANUAL);
  commit(root);
  good = await serve(root);
});

afterAll(async () => {
  for (const s of servers) await s.close();
  registry?.dispose();
  temps.forEach((t) => fs.rmSync(t, { recursive: true, force: true }));
});

type Summary = Record<string, unknown> & { id: string };
const list = async (c: Client, query = "") => {
  const r = await get(c, "/api/decisions" + query);
  expect(r.status, r.body).toBe(200);
  return r.json();
};

describe("GET /api/decisions (BE-API-02)", () => {
  it("lists every Decision in ID order with authority, lock status, origin and supersession from the files", async () => {
    const r = await list(good);
    expect(r.format).toBe("duo.ui.decisions/1");
    const data = r.data as { decisions: Summary[]; actorLabelsAuthenticated: boolean; truth: { complete: boolean; problems: unknown[] } };
    expect(data.decisions.map((d) => d.id)).toEqual(["D-001", "D-002", "D-003"]);
    const [d1, d2, d3] = data.decisions;
    expect(d1).toMatchObject({ state: "superseded", authority: "SUPERSEDED", locked: true, lockStatus: "valid", origin: "lifecycle", supersedes: null, supersededBy: "D-002", integrity: "ok", proposalId: "P-001" });
    expect(d2).toMatchObject({ state: "confirmed", authority: "CONFIRMED", locked: true, lockStatus: "valid", origin: "lifecycle", supersedes: "D-001", supersededBy: null, proposalId: "P-002", confirmedBy: "Ada" });
    expect(d3).toMatchObject({ state: "confirmed", authority: "CONFIRMED", locked: false, lockStatus: "missing", origin: "manual", integrity: "ok" });
    expect(d3).not.toHaveProperty("proposalId");
    expect(d2?.location).toEqual(expect.objectContaining({ path: ".duo-project/decisions/D-002.yaml" }));
    expect(data.actorLabelsAuthenticated).toBe(false);
    expect(data.truth).toEqual({ complete: true, problems: [] });
  });

  it("filters by state and by a case-insensitive match on ID or title; unknown or invalid parameters are 400", async () => {
    expect(((await list(good, "?state=superseded")).data.decisions as Summary[]).map((d) => d.id)).toEqual(["D-001"]);
    expect(((await list(good, "?q=sqlite")).data.decisions as Summary[]).map((d) => d.id)).toEqual(["D-002"]);
    expect(((await list(good, "?q=d-00&state=confirmed")).data.decisions as Summary[]).map((d) => d.id)).toEqual(["D-002", "D-003"]);
    for (const q of ["?state=active", "?sort=id", "?q="]) {
      const r = await get(good, "/api/decisions" + q);
      expect(r.status, q).toBe(400);
      expect(r.json().error?.code).toBe("UI_REQUEST_INVALID");
    }
  });
});

describe("GET /api/decisions/{id} (BE-API-02)", () => {
  it("returns one Decision with its content, the lock verification and the supersession chain oldest first", async () => {
    for (const id of ["D-001", "D-002"]) {
      const r = await get(good, "/api/decisions/" + id);
      expect(r.status).toBe(200);
      expect(r.json().format).toBe("duo.ui.decision-detail/1");
      const data = r.json().data as { status: string; decision: Record<string, unknown> };
      expect(data.status).toBe("found");
      expect(data.decision.chain).toEqual([
        { id: "D-001", state: "superseded", authority: "SUPERSEDED" },
        { id: "D-002", state: "confirmed", authority: "CONFIRMED" },
      ]);
    }
    const d2 = (await get(good, "/api/decisions/D-002")).json().data.decision as Record<string, unknown>;
    expect(d2).toMatchObject({ question: "database", answer: "sqlite", rationale: null, lock: { id: "D-002", status: "valid" } });
    const lock = d2.lock as { expected: string; recorded: string };
    expect(lock.recorded).toBe(lock.expected);
    const d3 = (await get(good, "/api/decisions/D-003")).json().data.decision as Record<string, unknown>;
    expect(d3).toMatchObject({ origin: "manual", lock: { status: "missing" }, chain: [{ id: "D-003", state: "confirmed", authority: "CONFIRMED" }] });
  });

  it("an unknown ID is not-found; a malformed or badly encoded ID and other methods are refused", async () => {
    const missing = (await get(good, "/api/decisions/D-099")).json();
    expect(missing.data).toMatchObject({ status: "not-found", id: "D-099", truth: { complete: true } });
    for (const p of ["/api/decisions/D%20001", "/api/decisions/%E0%A4%A", "/api/decisions/..%2F..%2Fproject", "/api/decisions/-D-001"]) {
      const r = await get(good, p);
      expect(r.status, p).toBe(400);
      expect(r.json().error?.code).toBe("UI_REQUEST_INVALID");
    }
    expect((await get(good, "/api/decisions/D-001/history")).status).toBe(404);
    const post = await send(good, "POST", "/api/decisions/D-001", { Cookie: good.cookie, Origin: good.server.origin, "Content-Type": "application/json", "X-Duo-CSRF": good.csrf }, "{}");
    expect(post.json().error?.code).toBe("UI_METHOD_NOT_ALLOWED");
  });

  it("needs the UI session like every other API route", async () => {
    expect((await send(good, "GET", "/api/decisions")).json().error?.code).toBe("UI_SESSION_REQUIRED");
    expect((await send(good, "GET", "/api/decisions/D-001", { Cookie: "duo_ui_1=forged" })).status).toBe(401);
  });

  it("reads only: no Truth file, Git state or working tree changes, and no absolute path or session secret in the bodies", async () => {
    const before = snapshot(good.root);
    const bodies: string[] = [];
    for (const p of ["/api/decisions", "/api/decisions?state=confirmed", "/api/decisions/D-001", "/api/decisions/D-002", "/api/decisions/D-003", "/api/decisions/D-099"]) bodies.push((await get(good, p)).body);
    expect(snapshot(good.root)).toEqual(before);
    expect(git(good.root, "status", "--porcelain")).toBe("");
    const secret = good.cookie.split("=")[1] ?? "";
    for (const b of bodies) {
      expect(b).not.toContain(good.root);
      expect(b).not.toContain(good.root.replaceAll("\\", "/"));
      expect(b).not.toContain(good.csrf);
      if (secret !== "") expect(b).not.toContain(secret);
    }
  });

  it("the existing direction and proposals routes are unchanged", async () => {
    const direction = (await get(good, "/api/direction")).json();
    expect(direction.format).toBe("duo.ui.direction/1");
    const decisions = (direction.data as { decisions: Record<string, unknown>[] }).decisions;
    expect(Object.keys(decisions[0] ?? {}).sort()).toEqual(["answer", "enforcement", "governs", "id", "label", "location", "locked", "question", "state", "supersededBy", "supersedes", "title"]);
    expect((await get(good, "/api/proposals")).json().format).toBe("duo.ui.proposals/1");
  });
});

describe("damaged or missing Truth (BE-API-02)", () => {
  it("reports a lock mismatch and an unreadable Decision file instead of hiding them, and never shows the machine path", async () => {
    const root = repo(PROJECT);
    const service = createDecisionService({ root });
    const p = await service.propose(agent, { title: "Use Postgres", question: "database", answer: "postgres" });
    if (p.value === undefined || (await service.confirm(human, p.value.proposalId)).value === undefined) throw new Error("setup");
    const d1 = path.join(root, ".duo-project/decisions/D-001.yaml");
    fs.writeFileSync(d1, fs.readFileSync(d1, "utf8").replace("answer: postgres", "answer: mysql"));
    fs.writeFileSync(path.join(root, ".duo-project/decisions/D-002.yaml"), "id: D-002\ntitle: [unclosed\n");
    commit(root);
    const c = await serve(root);
    const before = snapshot(root);
    const r = await list(c);
    const data = r.data as { decisions: Summary[]; truth: { complete: boolean; problems: { code: string; path?: string; message: string }[] } };
    expect(data.truth.complete).toBe(false);
    const codes = data.truth.problems.map((x) => x.code);
    expect(codes).toContain("DECISION_INTEGRITY_INVALID");
    expect(codes).toContain("YAML_SYNTAX_ERROR");
    expect(data.truth.problems.find((x) => x.code === "YAML_SYNTAX_ERROR")?.path).toBe(".duo-project/decisions/D-002.yaml");
    expect(data.decisions.map((d) => d.id)).toEqual(["D-001"]);
    expect(data.decisions[0]).toMatchObject({ authority: "CONFIRMED", lockStatus: "mismatch", integrity: "invalid" });
    expect((data.decisions[0]?.problems as { code: string }[]).map((x) => x.code)).toContain("DECISION_INTEGRITY_INVALID");
    const detail = (await get(c, "/api/decisions/D-002")).json().data as { status: string; truth: { complete: boolean } };
    expect(detail).toMatchObject({ status: "not-found", truth: { complete: false } });
    for (const b of [JSON.stringify(r), JSON.stringify(detail)]) {
      expect(b).not.toContain(root);
      expect(b).not.toContain(root.replaceAll("\\", "/"));
    }
    expect(snapshot(root)).toEqual(before);
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("proposed, rejected and Markdown Decisions, and chain markers for a missing link and a loop, come from the files as they are", async () => {
    const yaml = (id: string, extra: string[]) => [`id: ${id}`, `title: ${id} title`, "question: q", "answer: a", ...extra, ""].join("\n");
    const root = repo({
      ...PROJECT,
      ".duo-project/decisions/D-010.yaml": yaml("D-010", ["state: proposed"]),
      ".duo-project/decisions/D-011.yaml": yaml("D-011", ["state: rejected"]),
      ".duo-project/decisions/D-012.yaml": yaml("D-012", ["state: confirmed", "supersedes: D-099"]),
      ".duo-project/decisions/D-013.yaml": yaml("D-013", ["state: confirmed", "supersedes: D-014"]),
      ".duo-project/decisions/D-014.yaml": yaml("D-014", ["state: confirmed", "supersedes: D-013"]),
      ".duo-project/decisions/ADR-020.md": ["---", "id: ADR-020", "type: decision", "title: Use events", "state: confirmed", "question: messaging", "answer: events", "---", "", "# ADR-020 Use events", "", "Events between services.", ""].join("\n"),
    });
    commit(root);
    const c = await serve(root);
    const before = snapshot(root);
    const data = (await list(c)).data as { decisions: Summary[]; truth: { complete: boolean; problems: { code: string }[] } };
    const by = Object.fromEntries(data.decisions.map((d) => [d.id, d]));
    expect(by["D-010"]).toMatchObject({ state: "proposed", authority: "PROPOSED", locked: false, lockStatus: "not-confirmed", origin: null });
    expect(by["D-011"]).toMatchObject({ state: "rejected", authority: "REJECTED", lockStatus: "not-confirmed", origin: null });
    expect(by["ADR-020"]).toMatchObject({ state: "confirmed", authority: "CONFIRMED", origin: "manual", lockStatus: "missing", location: expect.objectContaining({ path: ".duo-project/decisions/ADR-020.md" }) });
    expect(((await get(c, "/api/decisions/ADR-020")).json().data as { status: string }).status).toBe("found");
    const chain = async (id: string) => ((await get(c, "/api/decisions/" + id)).json().data as { decision: { chain: unknown[] } }).decision.chain;
    expect(await chain("D-012")).toEqual([{ id: "D-099", missing: true }, { id: "D-012", state: "confirmed", authority: "CONFIRMED" }]);
    expect(await chain("D-013")).toEqual([{ id: "D-013", loop: true }, { id: "D-014", state: "confirmed", authority: "CONFIRMED" }, { id: "D-013", state: "confirmed", authority: "CONFIRMED" }]);
    // The supersede cycle is a Truth error: shown, not hidden, and Truth is reported incomplete.
    expect(data.truth.complete).toBe(false);
    expect(snapshot(root)).toEqual(before);
  });


  it("a repository without DUO answers not-initialized", async () => {
    const root = repo({ "README.md": "# none\n" });
    commit(root);
    const c = await serve(root);
    expect((await list(c)).data).toMatchObject({ status: "not-initialized" });
    expect((await get(c, "/api/decisions/D-001")).json().data).toMatchObject({ status: "not-initialized" });
  });
});
