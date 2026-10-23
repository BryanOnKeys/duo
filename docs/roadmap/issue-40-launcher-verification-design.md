# Issue 40-1: launcher verification design

Status: draft for BE-1 review; the warning policy still needs maintainer confirmation.
Date: 2026-10-23. Source baseline: `next` `6c6c872`.
Issue: [#40](https://github.com/kanghyunsoon/duo/issues/40).
Brief: [T91](https://github.com/kanghyunsoon/duo/issues/40#issuecomment-6284137321).

This change records the reproduction and proposed implementation boundary. It changes no production behavior, launcher selection, configuration, output format or exit code.

## Reproduction

Run from the workspace:

```sh
pnpm exec vitest run packages/integration/src/agents/launcher-path.repro.test.ts
pnpm exec vitest run packages/integration/src/agents/agents.test.ts
```

The deterministic fixture creates a newer-looking project-local launcher and an older-looking global launcher. It passes two explicit host environments to the existing `checkLauncher`, without changing the user's PATH:

| Environment | PATH order | Current resolution |
|---|---|---|
| Installer under npm exec | project `node_modules/.bin`, global bin | project-local launcher |
| Agent outside npm exec | global bin | global launcher |

Both Codex and Claude Code adapters keep `command: "duoctl"`; generating the configuration does not pin the executable checked during install. Fixture versions label the files only: this test does not start a server, run npm exec, or claim a measured version handshake.

The current verification path confirms the second cause by inspection: `verifyAgentIntegration` uses the supplied host for `checkLauncher` and forwards the same PATH to `probeMcpLaunch`. It records `probe.serverVersion`, but its `ok` only checks configuration, bridge, launcher availability, server name and tools. No running CLI version is passed in or compared. Doctor displays the returned version but also accepts `verify.ok` without comparison.

## Proposed behavior (not approved)

| Situation | Install verification | Doctor |
|---|---|---|
| Launcher and running CLI versions match | Existing success result | Existing verified status |
| Known versions differ | Preserve `ok` and exit codes; add `launcher-version-mismatch`, both versions and resolved path | Warning and safe next action |
| Probe skipped/failed, or either version missing | No mismatch claim | Existing failure/offline behavior |

Use the existing MCP initialize version, not an additional `--version` subprocess. Pass the running CLI version explicitly from the CLI into integration and doctor; never import CLI internals into a package. Existing internal callers without that version must not invent one.

Safe next steps are suggestions only: update the global installation to the running version, or reinstall with explicit `--launcher npx` when DUO is a project dependency. Do not automatically update packages, switch launchers or rewrite an absolute executable path into shared configuration.

## PATH rule to review before implementation

For a `path` launcher, planning, executable lookup and the MCP probe must use the same effective host. Under npm exec, filter the npm-added `node_modules/.bin` entries (project, ancestor projects and npx cache); preserve the order of all other entries and Windows PATHEXT semantics. Keep explicit `npx` and absolute custom launchers unchanged.

Proposed activation: `host.env.npm_command === "exec"`, with directory entries recognized by normalized terminal path segments `node_modules/.bin`. Use platform-appropriate separators and Windows case handling; do not inspect or modify the real process environment. The implementation must test the actual npm-exec environment markers before adopting this predicate.

This is an approximation, not recovery of the agent's original environment: npm does not identify which identical PATH entries were already present, and a GUI-launched agent may have another PATH. BE-1 must review the activation and filtering boundary. Do not remove arbitrary bin directories or claim equivalence with every GUI environment.

## Change reach

| Surface | Planned work |
|---|---|
| `packages/integration/src/agents/launcher.ts` | Pure effective-host policy, shared by planning and verification |
| `packages/integration/src/agents/integration.ts` | Use the same effective host for lookup/probe; compare supplied runtime version; additive warning |
| `packages/integration/src/agents/types.ts` | Additive verification warning fields only; retain existing check meanings |
| `packages/integration/src/operations/doctor.ts` | Forward the runtime version already supplied by the CLI; existing agent check becomes warning on mismatch |
| `apps/cli/src/commands/install.ts`, `doctor.ts`, `messages.ts` | Pass version; render versions, resolved path and safe actions in en/ko |
| Agent unit, CLI install and doctor tests | Fake PATH/version cases for both adapters; Windows and POSIX CI |
| CLI/MCP documentation | Explain the diagnostic, safe remediation and GUI PATH limitation |

No schema migration, new MCP tool, MCP tool schema change, Decision authority change, trust/approval automation, one-command setup or discovery timing change belongs in this issue. Preserve installation/removal backups and safety checks, `launch: false`, and offline behavior.

## Work split and acceptance evidence

1. **40-1 (1 SP):** this note and deterministic resolution reproduction; BE-1 review before production implementation.
2. **40-2 (2 SP):** reviewed effective-host policy, lookup/probe consistency and targeted tests.
3. **40-3 (2 SP):** additive version-mismatch warning and CLI rendering. No change to install success or exit codes.
4. **40-4 (2 SP):** doctor warning, facts and en/ko remediation.
5. **40-5 (3 SP):** real subprocess regression with fake older server for Codex and Claude Code, explicit npx/custom launchers, removal, offline and unavailable versions.

A resolution-only test is not proof that the configured process reports the expected version. The subprocess and CLI checks above remain required before closing #40. Draft PRs target `next`; warning policy confirmation is required before leaving draft. Publishing 0.3.4 is a separate maintainer decision.

## Client and model boundary

#40 tests executable resolution, process environment and the MCP handshake; it does not require an LLM or require writing the fix in Claude Code. Both adapters need coverage.

[#31](https://github.com/kanghyunsoon/duo/issues/31) separately asks whether the real Claude Code client starts DUO, exposes tools and calls them during a task. A gateway-backed setup must record client version, gateway version, actual upstream model, tool-search settings and launch environment. A non-Claude model cannot establish Claude-model behavior or an ordinary supported Claude Code baseline. Do not change global client/provider settings or run paid/account-consuming tasks as part of 40-1.

## Validation record

Windows, Node 24.18.0, pnpm 11.25.0; source baseline `6c6c872`.

- Existing Agent unit tests: 18 passed before adding the reproduction.
- Combined existing and reproduction tests: 2 files, 20 passed (2 new resolution cases).
- Workspace typecheck, targeted ESLint and package boundary checks: passed.
- Documentation validation: passed (120 Markdown files before adding the document-map entry).
- Not tested: an actual npm-exec invocation, a versioned MCP subprocess/installed CLI mismatch, real Codex/Claude Code task behavior, or POSIX execution. The fake-host predicate and full regression matrix still need their own evidence.
- No model/API experiment, global PATH change, provider change or production implementation.
