# Real-work token A/B: ssafesta daily mission launcher

Opt-in local experiment; never part of CI. Runs six independent Codex sessions on the same historical task, with and without DUO. It does not edit the original ssafesta checkout, product UI/API, or push anything.

## Reproduce

Prerequisites: Windows, Node 24+, Python 3.12+, Git, authenticated Codex CLI, and npm access/cache. Build this DUO checkout first. The original ssafesta checkout must contain the commits below; its uncommitted changes are excluded.

```powershell
node --test bench/token-ab/metrics.test.mjs
node bench/token-ab/run.mjs --stage prepare --id my-experiment --source C:\path\to\ssafesta
node bench/token-ab/run.mjs --stage preflight --id my-experiment
node bench/token-ab/run.mjs --stage run --id my-experiment
node bench/token-ab/run.mjs --stage summarize --id my-experiment
```

`--stage all` performs all stages. Use the same explicit `--id` throughout. Completed measured runs are skipped, while a partial measured run is never silently overwritten or rerun. Preparation/evaluator failures must be resolved before measured sessions. Results are ignored under `bench/results/local/token-ab/<id>/`; independent repos and shared locked dependencies are under a recorded temporary directory. Keep the temporary directory until inspecting the results; this runner does not recursively delete it.

## Fixed protocol

- Historical task: S15P21A604-911. Input code: `fc3c51644cdfeff444d5c791345e41d01df7547a`. Task plan and evaluator reference: `b2c92d5c93486c0e6d7a9ba15411f253807b2a32`.
- Export the complete historical tree, add the same already-approved task plan to both arms, and initialize a fresh local Git history containing only this input. No original history, remote, later implementation, current dirty files, or prior conversation is supplied.
- Fixed model `gpt-5.6-terra`, reasoning `low`, order A1/B1/B2/A2/A3/B3, fresh ephemeral CLI session per run, twenty-minute execution limit.
- Both arms retain the same project SDD/rules and normal development tools. User config, external plugins/apps/browser tools, global skill discovery, web search, memory and subagents are disabled. No session is resumed.
- A has no DUO state/MCP. B receives only the local DUO MCP, initialized and indexed against its own snapshot with the internal LLM disabled. B must request context before implementation exploration and review changes before finishing; extra searches and index retries are allowed and counted.
- Dependencies are installed once from the historical lock and copied into each measured repo without shared writable build/test caches. Setup, initial DUO indexing, calibration and external grading are outside measured agent usage and recorded separately. All exploration, commands, tool responses, tests and retries performed by the measured agent are inside its usage.
- Standalone CLI shell execution uses `danger-full-access`, matching the host's existing execution permissions; workspace-write rejected even a read-only Git command in calibration. Workspace boundaries are an instruction constraint, not an OS read-isolation guarantee. Agents receive no original checkout path, history, external tools, or previous session context. Parent app/session environment variables are removed.

## Grading and accounting

Before agents run, every snapshot's tracked paths and Git blob hashes must equal the original commit plus the task plan. Archive files are force-added to the synthetic baseline: files tracked before a later `.gitignore` rule must remain tracked and survive cloning. The actual cloned pre-feature input must build. The reference implementation must pass the evaluator, lint and full build, while the pre-feature negative control must fail acceptance tests. Excluded calibrations verify model access, provider usage events, shell execution, and DUO MCP calls using the same runtime environment as measured sessions.

Only after each agent exits does the evaluator install reference-derived tests. They cover member/guest/anonymous access, existing panel navigation, no launcher mission API calls, dynamic reward toast (31 coins rather than the reference's 15), mission/wallet invalidation, wallet labels, HUD mouse focus and fullscreen regression. Relevant tests, lint and full build must pass. Agent diffs/status are captured before installing held-out tests; graders do not compare code against a reference diff.

Raw JSONL and stderr, prompt/settings, diff, acceptance/lint/build logs, manifest hashes, per-run JSON and summary JSON/Markdown remain available. Provider usage comes exclusively from `turn.completed.usage`; input already includes cached input, and output already includes reasoning. Unknown usage is null, never a tokenizer estimate or zero. The metric tests cover these accounting pitfalls and exclusion of failed cheap runs.

All six outcomes are reported. Savings `(A-B)/A*100` are computed only for pairs where both sides pass with complete measured usage and treatment compliance. Report the median/range, cached input separately, failures and exclusions. Three repetitions of one SDD-heavy task provide descriptive pilot evidence, not a general effectiveness claim or a controlled cache experiment. Logical token totals are not account quota consumption or monetary cost.
