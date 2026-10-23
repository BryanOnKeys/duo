# Issue 40-1: launcher verification design

Status: BE-1 design review received; documentation revisions only. Decisions D1 and D2 below await maintainer confirmation before 40-2 starts. Keep the PR in draft until both decisions are posted.
Date: 2026-10-23. Source baseline: `next` `6c6c872`.
Issue: [#40](https://github.com/kanghyunsoon/duo/issues/40).
Brief: [T91](https://github.com/kanghyunsoon/duo/issues/40#issuecomment-6284137321).
Review: [BE-1 feedback](https://github.com/kanghyunsoon/duo/pull/75#issuecomment-6355715433).

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

## Proposed behavior (decisions pending)

| Situation | Install verification | Doctor |
|---|---|---|
| Launcher and running CLI versions match | Existing checks determine success | Existing verified status only if checks pass |
| Known, non-empty versions differ | **D2 pending:** add `launcher-version-mismatch`, both versions and resolved path; the warning itself preserves the result of existing checks and its exit code | Proposed warning and safe next action; do not hide existing errors |
| Probe skipped/failed, or either version missing or `""` | No mismatch claim; retain existing failure/offline behavior | Existing failure/offline behavior |
| Filtered agent PATH contains no `duoctl` | **D1 pending:** choose verification failure or preservation of `ok` with a warning suggesting `--launcher npx`; see the alternatives below | No server version is available; unavailable-launcher handling follows the confirmed policy |

Use the existing MCP initialize version, not an additional `--version` subprocess. Pass the running CLI version explicitly from the CLI into integration and doctor; never import CLI internals into a package. Existing internal callers without that version must not invent one.

A missing version includes `undefined` and the empty string: `probe.serverVersion` is `""` when initialize reports no version (`packages/integration/src/mcp/probe.ts`). Compare exact version strings only when both are present and non-empty. Do not interpret semver ranges or normalize versions to manufacture a match or mismatch.

### D1: no launcher on the agent PATH (decision pending)

The common example is DUO installed only as a project devDependency, followed by `npx duoctl install codex` with the default `path` launcher. Today's installer resolves the injected project-local binary, but the agent outside that runner has no `duoctl`. After filtering, `checkLauncher` returns `available: false` and no MCP probe can run.

The maintainer must choose between:

1. **Fail verification:** keep the unavailable-launcher check failing, so `verify.ok` is false and the install verification branch returns `EXIT.ERROR` (`apps/cli/src/commands/install.ts`). This reports the real inability to start the agent's launcher, but changes success/exit behavior for an installation that currently verifies through the injected local binary.
2. **Preserve `ok` with a warning:** explicitly approve an exception for this unavailable-launcher case and suggest reinstalling with `--launcher npx`. This preserves the previous success result, but the configured PATH launcher still cannot start until the user takes that action. Do not describe it as a successful MCP launch or a verified server version.

Neither alternative is selected or implemented by this note.

### D2: version-mismatch warning (decision pending)

The proposal is to retain the existing check result and add `launcher-version-mismatch` with the running CLI version, actual server version, resolved path and both safe next steps. A version warning alone does not make a successful verification fail, and it does not turn an existing failure into success. BE-1 considers this consistent with T91; final maintainer confirmation is still pending.

Safe next steps are suggestions only: update the global installation to the running version, or reinstall with explicit `--launcher npx` when DUO is a project dependency. Do not automatically update packages, switch launchers or rewrite an absolute executable path into shared configuration.

## PATH rule and runner evidence required for 40-2

For a `path` launcher, planning, executable lookup and the MCP probe must use the same effective host. Under a covered runner, filter the runner-added `node_modules/.bin` entries (project, ancestor projects and cache); preserve the order of all other entries and Windows PATHEXT semantics. Keep explicit `npx` and absolute custom launchers unchanged.

The initial candidate `host.env.npm_command === "exec"` targets `npx` and `npm exec`; it is not a final activation predicate. `npm run <script>` may use `run-script`, and the other runners may expose different markers. Choose the predicate from real invocations recorded during 40-2, after D1 and D2 are confirmed. If the predicate does not fire, verification keeps today's behavior and that runner's stale-launcher case remains unfixed.

For **each** runner below, the 40-2 test notes must record the runner version and OS, the actual `npm_command`, `npm_execpath` and `npm_lifecycle_event` values (including unset values), and the relevant PATH order. No real runner invocation has been measured in 40-1; the fake-host resolution test is not runner evidence.

| Runner | Environment-marker evidence | Coverage claim at this design stage |
|---|---|---|
| `npx` | Not measured; record all three markers in 40-2 | Initial candidate target; not verified |
| `npm exec` | Not measured; record all three markers in 40-2 | Initial candidate target; not verified |
| `npm run <script>` | Not measured; record all three markers in 40-2 | Not claimed by the initial candidate |
| `pnpm exec` | Not measured; record all three markers in 40-2 | Not claimed by the initial candidate |
| `pnpm dlx` | Not measured; record all three markers in 40-2 | Not claimed by the initial candidate |
| `yarn` | Not measured; record the exact subcommand and all three markers in 40-2 | Not claimed by the initial candidate |

The final test notes must explicitly list covered runners and remaining gaps. An unavailable runner is recorded as not tested, not inferred to be supported. Once activation is chosen, recognize directory entries by normalized terminal path segments `node_modules/.bin`, with platform-appropriate separators and Windows case handling; do not inspect or modify the real process environment in the policy helper.

This is an approximation, not recovery of the agent's original environment: runners do not identify which identical PATH entries were already present, and a GUI-launched agent may have another PATH. BE-1 must review the activation and filtering boundary. Do not remove arbitrary bin directories or claim equivalence with every GUI environment.

## Compatibility boundary

The current 40-1 documentation and resolution test change no production behavior. The planned 40-2 PATH correction can change verification success and exit codes:

- The previously hidden no-launcher case can fail; its exact policy is pending D1.
- An actual older global binary can start but expose a different tool list. The existing `mcp-launch` check compares its tools with this build's `EXPECTED_MCP_TOOLS` (and checks the server name), so verification can now fail where probing the injected local binary currently passes. Keep that validation intact and report the real result; the install verification branch then returns `EXIT.ERROR`.

The unchanged-success/exit-code claim applies only to adding the 40-3 version-mismatch warning itself, pending D2. It is not a promise for 40-2 or the whole issue. A matching or unknown version does not override a failed launcher, server-name or tool-list check.

## Change reach

| Surface | Planned work |
|---|---|
| `packages/integration/src/agents/launcher.ts` | Pure effective-host policy, shared by planning and verification |
| `packages/integration/src/agents/integration.ts` | Use the same effective host for lookup/probe; compare supplied runtime version; additive warning |
| `packages/integration/src/agents/types.ts` | Additive verification warning fields; any unavailable-launcher exception requires D1 confirmation |
| `packages/integration/src/operations/doctor.ts` | Forward the runtime version supplied by the CLI; add the proposed mismatch warning without downgrading failed checks |
| `apps/cli/src/commands/install.ts`, `doctor.ts`, `messages.ts` | Pass version; render versions, resolved path and safe actions in en/ko |
| Agent unit, CLI install and doctor tests | Fake PATH/version cases for both adapters; Windows and POSIX CI |
| CLI/MCP documentation | Explain the diagnostic, safe remediation and GUI PATH limitation |

No schema migration, new MCP tool, MCP tool schema change, Decision authority change, trust/approval automation, one-command setup or discovery timing change belongs in this issue. Preserve installation/removal backups and safety checks, `launch: false`, and offline behavior.

## Work split and acceptance evidence

1. **40-1 (1 SP):** this note and deterministic resolution reproduction; BE-1 review before production implementation.
2. **40-2 (2 SP):** after D1 and D2 confirmation, measure real runner markers, state coverage, implement the reviewed effective-host policy and lookup/probe consistency with targeted tests, including the no-launcher case.
3. **40-3 (2 SP):** after D2 confirmation, additive version-mismatch warning and CLI rendering; test exact strings, missing/empty versions and existing failures. The warning itself does not change the result/exit code of the existing checks.
4. **40-4 (2 SP):** doctor warning, facts and en/ko remediation.
5. **40-5 (3 SP):** real subprocess regression with fake older server for Codex and Claude Code, explicit npx/custom launchers, missing agent-PATH launcher, removal, offline and missing/empty versions.

A resolution-only test is not proof that the configured process reports the expected version. The subprocess and CLI checks above remain required before closing #40. Draft PRs target `next`; D1 and D2 must be posted before 40-2 starts, and the PR stays in draft until both are confirmed. Publishing 0.3.4 is a separate maintainer decision.

## Client and model boundary

#40 tests executable resolution, process environment and the MCP handshake; it does not require an LLM or require writing the fix in Claude Code. Both adapters need coverage.

[#31](https://github.com/kanghyunsoon/duo/issues/31) separately asks whether the real Claude Code client starts DUO, exposes tools and calls them during a task. A gateway-backed setup must record client version, gateway version, actual upstream model, tool-search settings and launch environment. A non-Claude model cannot establish Claude-model behavior or an ordinary supported Claude Code baseline. Do not change global client/provider settings or run paid/account-consuming tasks as part of 40-1.

## Validation record

Windows, Node 24.18.0, pnpm 11.25.0; source baseline `6c6c872`.

- Existing Agent unit tests: 18 passed before adding the reproduction.
- Combined existing and reproduction tests: 2 files, 20 passed (2 new resolution cases).
- Workspace typecheck, targeted ESLint and package boundary checks: passed.
- Documentation validation after BE-1 revisions: passed (120 Markdown files). This revision changes documentation only; the recorded code-test results above were not rerun.
- Not tested: an actual npm-exec invocation, a versioned MCP subprocess/installed CLI mismatch, real Codex/Claude Code task behavior, or POSIX execution. The fake-host predicate and full regression matrix still need their own evidence.
- No model/API experiment, global PATH change, provider change or production implementation.
