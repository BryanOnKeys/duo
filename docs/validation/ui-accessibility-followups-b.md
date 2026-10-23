# Accessibility follow-up B: Overview focus boundary (#73)

## Scope and evidence

This report records the #73 investigation separately from the source audit output. The committed report contains a sanitized summary; raw JSON, JSONL, screenshots, and other run evidence stay in the ignored `.duo-a11y-runs/<runId>/` directory.

| Field | Value |
| --- | --- |
| Base SHA | `0521fd77c0681988a09a27f0ea826d983bb52563` (`next`) |
| Tested code SHA | `73ec8ecb6d0d5568f65cb1148e97d92cbc7da01d` |
| Audit schema / rules | schema version 3; WCAG 2 A/AA, WCAG 2.1 A/AA, WCAG 2.2 AA; supplemental table rules enabled |
| Run ID | `2026-10-23T08-27-38-864Z-20224` |
| Environment | Windows 11; Node `v24.18.0`; pnpm `11.25.0`; Playwright `1.63.0`; axe-core `4.14.0`; Chrome `155.0.8059.85` |
| Viewports | 1280px desktop and 320px mobile viewport emulation in desktop Chrome; no physical device or external keyboard was used |

The raw run contains 120 cases: 12 passed, 29 with product findings, 0 tool errors, and 79 unverified. There are no missing or duplicate cases, no cleanup errors, and execution completed. Accessibility verification remains incomplete because manual review is outstanding.

## #73 finding and case-level change

The `keyboard-navigation` case was previously classified as a product issue because the next Tab was observed on `BODY`. This run found that the Overview page and a plain HTML control page produce the same forward and reverse page-internal order at both viewport widths. The expected internal sequences passed, with no missing, unexpected, duplicated, or reordered targets. The forward boundary observation was `BODY` on both pages.

| Case ID | Earlier result | Current result | Evidence |
| --- | --- | --- | --- |
| `keyboard-navigation` | Product issue | Unverified | Internal forward/reverse sequences and focus visibility passed at both viewports; `BODY` matched the normal HTML control. Browser UI focus leaving and returning could not be observed. |

The comparison run was `2026-10-23T07-36-04-993Z-25256` at reference SHA `17d222eb1d39c1d92b7d75fb0110eb8f3539bbcf`. Across the 120 case IDs, `keyboard-navigation` was the only case whose status changed. The reference predates the current base SHA; the current tested run is authoritative for the result above.

The evidence does not establish the browser chrome boundary or returning focus from browser UI. That portion remains **unverified** and is not counted as a pass. No artificial focus loop was added. The audit's `accessibilityVerificationComplete` remains `false`.

## Verification

- `pnpm typecheck` — passed.
- `pnpm lint` — passed.
- `pnpm exec vitest run tests/ui/ui-a11y-artifacts.test.ts --reporter=verbose` — 11 passed, including missing, unexpected, duplicated, reordered, and trapped focus sequences.
- `pnpm test:ui:a11y` at the tested code SHA — 120 cases; 0 missing, duplicate, tool, or cleanup errors; `accessibilityVerificationComplete: false`.
- `pnpm exec vitest run tests/ui/ui.browser.e2e.test.ts --reporter=verbose` — 6 passed.
- `pnpm verify` — passed: 142 test files, 1,329 passed, 7 skipped, 5 TODO; documentation validation passed for 150 files.

This is a viewport-emulation result. Physical mobile device and browser UI boundary checks still require manual evidence.
