# Unreleased: launcher verification (#40-1 through #40-3)

Draft notes for #40 (PR #75 and its 40-4/40-5 follow-up). This is not release authorization; shipping as 0.3.4 remains a separate maintainer decision.

`duoctl install` uses the same effective PATH for planning, launcher lookup and its MCP probe. Under measured runner signatures, project/ancestor/cache `node_modules/.bin` entries are removed for the default PATH launcher. Explicit npx and custom/absolute launchers keep their existing PATH behavior. Generated config still records portable commands.

## Compatibility and changed failures

A launcher that existed only on the installer's injected PATH is no longer reported as available. Pre-apply planning blocks with exit 6 and an actionable `--launcher npx` recommendation; no integration config is written. A reached verification failure remains exit 1. This intentionally changes formerly successful local-only installations.

Probing the actual older global binary can also reveal a different server/tool list. Those MCP failures remain failures, even when a version warning is present.

Under a matched runner, every `node_modules/.bin` on PATH is removed, including one the user added before running the installer (for example with direnv). If `duoctl` was only reachable there, install now fails although an agent started from the same shell would find it. Reinstall with `--launcher npx` or install `duoctl` globally.

## Version warning

When both the running CLI and launched MCP server report known, non-empty, exactly different version strings, install reports `launcher-version-mismatch` with both versions, the resolved launcher path and safe remediation. Human output supports en/ko; JSON adds an optional `verify.warnings` array. The warning alone does not change success or exit status. Missing/empty versions are unknown; no semver-range interpretation occurs. Updates and launcher changes require a user action.

`duoctl doctor` reports the same difference: a connected agent whose checks all pass shows warning `version-mismatch` (facts `cliVersion`, `serverVersion`, `resolved`; action `align-launcher`) instead of `verified`. Errors such as a tool-list mismatch are unchanged, and doctor still exits 0 for warnings. The remediation text names the resolved installation rather than "the global DUO installation".

## Coverage and limits

Measured on Windows: npm 12.0.1 npx/exec/run, pnpm 11.25.0 exec, Yarn Classic 1.22.22 run (partial: Yarn's own `Yarn\bin` and temporary shim directory stay on PATH). pnpm dlx has no distinguishing values in the measured markers and retains the previous behavior. npm lifecycle shortcuts such as `npm test`/`npm start`, npm `run-script` signatures and `pnpm run` were not measured and keep the previous behavior. Other versions, Yarn Berry/PnP, POSIX runner invocations and GUI PATH equivalence are not claimed. See the [design and runner evidence](../roadmap/issue-40-launcher-verification-design.md).
