# Decision compliance walkthrough with the published CLI 0.3.3

Every command and output on this page comes from a real run on 2026-10-19 on Windows 11 with Node.js 24.18.0 and `@duo-director/cli@0.3.3` from npm, in a new disposable Git repository. Where the run differs from everyday use, the page says so.

What it shows: a Decision that a person confirmed forbids direct imports of `src/db/legacy-db.ts`. A change adds such an import, and `duoctl review` returns `BLOCK` with the file and line. After the import is removed, the same review returns `PASS`. The review makes no LLM calls.

## 1. A disposable repository

```powershell
mkdir duo-demo-shop; cd duo-demo-shop
git init -b main
```

Three TypeScript files and a `package.json` (`{ "name": "duo-demo-shop", "version": "1.0.0", "type": "module", "private": true }`):

```text
src/db/legacy-db.ts   export class LegacyDb { query(sql: string): string[] { return [sql]; } }
src/db/client.ts      export class DbClient { orders(): string[] { return ["order-1"]; } }
src/ui/orders.ts      import { DbClient } from "../db/client.js";
                      export function orderList(): string[] { return new DbClient().orders(); }
```

Add `node_modules/` to `.gitignore` and commit. DUO needs a first commit.

## 2. Install, set up, connect Codex

```text
$ npm install --save-dev @duo-director/cli@0.3.3
added 1 package in 13s
$ git add package.json package-lock.json .gitignore; git commit -m "chore: pin DUO demo dependencies"
$ npx --no-install duoctl --version
duoctl 0.3.3
$ npx --no-install duoctl init --yes --non-interactive
Repository ok · duo-demo-shop · typescript · 6 files · branch main
Truth      ok · 4 files
Index      ok · full (no-state) · 10 files
Baseline   ok · 5fddd2c5e2bf · 0 pre-existing findings
$ npx --no-install duoctl install codex --yes --non-interactive
install codex: create 2 · modify 0 · delete 0 · unchanged 0
  create .codex/config.toml
  create AGENTS.md
Verify: ok
Launcher: duoctl (<repo>\node_modules\.bin\duoctl.cmd · duoctl 0.3.3)
  ✓ mcp-launch · duo-director · 9 tools
$ npx --no-install duoctl doctor
DUO Doctor · ready
```

Output is shortened to the relevant lines. Commit the new `.duo-project/`, `.codex/config.toml` and `AGENTS.md`. Without `--yes`, `install codex` shows the plan and asks first. In Codex, trust the folder so it loads `.codex/config.toml` (see the README Quick start).

**Check which `duoctl` your agent will start.** `.codex/config.toml` runs `command = "duoctl"`, which Codex resolves from your normal PATH. Verification above ran under `npx`, which puts `node_modules/.bin` first. In this run a plain shell resolved `duoctl` to an older global 0.2.0, so Codex would have started 0.2.0 even though verification said `ok` for 0.3.3. Run `duoctl --version` in a normal terminal in the project. This is tracked in [#40](https://github.com/kanghyunsoon/duo/issues/40).

## 3. An agent proposes a Decision

Agents create Decisions only as proposals, through the MCP tool `duo_propose_decision`. In this run a small MCP client called the tool with the agent label `codex` and these arguments. In everyday use your coding agent makes this call.

```json
{
  "title": "UI code must not import the legacy database module",
  "question": "May code import src/db/legacy-db.ts directly?",
  "answer": "No. New code reads data through src/db/client.ts (DbClient).",
  "rationale": "LegacyDb is kept only for old reports; DbClient is the supported data layer.",
  "governs": { "paths": ["src/ui/**", "src/db/**"] },
  "forbids": { "imported_paths": ["src/db/legacy-db.ts"] },
  "enforcement": "block"
}
```

DUO answered with `"proposalId": "P-001"`, `"confirmed": false` and `"notice": "A proposal only. A human confirms or rejects it (duoctl decision, Web UI); agents cannot."`

## 4. A person confirms it

```text
$ npx --no-install duoctl decision confirm P-001
Confirm P-001: this proposal becomes a new confirmed Decision.
  Title         UI code must not import the legacy database module
  Question      May code import src/db/legacy-db.ts directly?
  Answer        No. New code reads data through src/db/client.ts (DbClient).
  Kind          (not set)
  Rationale     LegacyDb is kept only for old reports; DbClient is the supported data layer.
  Governs       paths: src/ui/**, src/db/**
  Forbids       imported_paths: src/db/legacy-db.ts
  Forbids scope repository-wide (governs does not narrow forbids)
  Enforcement   block
  Supersedes    (not set)
  Proposed by   codex (agent)
  Stale         no
  Expected ID   D-001 (expected; the ID in the confirm result is authoritative)
  File          .duo-project/decisions/proposals/P-001.yaml
Type the ID to confirm: P-001
confirmed as D-001 · .duo-project/decisions/D-001.yaml
Run duoctl index so review and context see it.
$ npx --no-install duoctl index
Indexed (incremental) · 11 files · 0 parsed · 1 changed · graph updated
```

This step is meant for a person. It needs an interactive terminal and the ID typed again. In this verification run the ID was typed through an automated terminal session. That is possible because the prompt is a guard against mistakes, not authentication. Commit the new Decision file.

## 5. A change breaks the Decision

`src/ui/orders.ts` gets a second import:

```ts
import { DbClient } from "../db/client.js";
import { LegacyDb } from "../db/legacy-db.js";

export function orderList(): string[] {
  return [...new DbClient().orders(), ...new LegacyDb().query("select * from old_orders")];
}
```

```text
$ npx --no-install duoctl review --fail-on block
INDEX_REQUIRED: the index is stale. Run duoctl index (or pass --refresh).
(exit code 6)
$ npx --no-install duoctl review --refresh --fail-on block
BLOCK  1 claims · 1 files · llm_calls 0
  CONFLICT  decision-forbids-import    D-001 · forbidden-import [blocking, not-in-adoption-baseline]
            authority: current authority
            observed: forbidden import on a changed line: src/ui/orders.ts:2 import "../db/legacy-db.js" resolves to src/db/legacy-db.ts
            evidence: src/db/legacy-db.ts, src/ui/orders.ts:2-2, .duo-project/decisions/D-001.yaml:1-23
Limitations:
  calls-exact-only
  no-task-scope
(exit code 4)
```

Every code change makes the index stale, so `review` needs `--refresh` or a `duoctl index` first ([#4](https://github.com/kanghyunsoon/duo/issues/4)). The verdict becomes an exit code only with `--fail-on`.

## 6. Fix it and review again

```ts
import { DbClient } from "../db/client.js";

export function orderList(): string[] {
  return new DbClient().orders().filter((id) => id.startsWith("order-"));
}
```

```text
$ npx --no-install duoctl review --refresh --fail-on block
PASS  0 claims · 1 files · llm_calls 0
Limitations:
  calls-exact-only
  no-task-scope
PASS means: no project-direction violation found in the available evidence (not: no bugs).
(exit code 0)
```

## What this does not show

- PASS means no violation was found in the evidence DUO has, not that the code is correct.
- `forbids.imported_paths` applies to the whole repository. `governs` does not narrow it.
- Imports DUO cannot resolve, computed or dynamic imports and imports through a barrel file can be missed. Confirmed constraints written in plain language are not checked; DUO names them as not checked.
- One check on one small repository. It is not a benchmark. The [README benchmarks](../../README.md#why-not-just-agentsmd-claudemd-or-repository-rules) found that simple scripts reached the same verdicts on fixed fixtures.
- Only Windows was verified. macOS and Linux reports are welcome ([#43](https://github.com/kanghyunsoon/duo/issues/43)).

An earlier example recorded with Codex on 0.3.0-rc.1, where the agent itself wrote the violating file, is in the [README](../../README.md#a-decision-compliance-example).

