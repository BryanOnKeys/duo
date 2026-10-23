# PR #63 review response and follow-up issue drafts

Prepared 2026-10-23. These drafts are not published.

## PR review reply draft

Thanks for the review. I sanitized the shareable audit summary and per-case JSON/JSONL: machine-local paths and Git status are omitted, and serialized error messages, stacks, causes, and aggregate error contents are redacted. With `DUO_A11Y_LOCAL_DIAGNOSTICS=1`, original diagnostics are written only under the ignored `.duo-a11y-runs/local-diagnostics/<runId>/` directory. The artifact schema is now version 3. Regression coverage includes Windows, POSIX, and UNC-style sensitive paths and nested error data.

I also replaced the fixed Work map keyboard wait with a state-based wait (up to five seconds) and removed the unrelated Java fixture ignore entries. The latest audit completed all 120 cases with no missing or duplicate cases and no tool errors. It recorded 30 product-issue cases and 78 cases with unverified status (108 cases contain unverified findings); `executionComplete` is true and `accessibilityVerificationComplete` remains false. The sanitized evidence example and results are in `docs/validation/ui-accessibility-297.md`.

The four product findings remain separate follow-up work and are not fixes in this audit PR. I will link their tracking issues before marking #62 complete. Screenshot review, axe `incomplete` review, and screen-reader listening remain outstanding.

## Follow-up issue drafts

### Mobile horizontal overflow in supported screens

**Problem:** The accessibility audit found document-level horizontal overflow at the 320px viewport on multiple screens and in Decision dialogs.

**Reproduction:** Run `pnpm test:ui:a11y` and inspect the mobile viewport cases and their screenshots in the generated audit run. Compare `documentScrollWidth` with `documentClientWidth` for each affected route.

**Expected:** Supported screens and dialogs fit the 320px viewport, except for explicitly identified, operable horizontal canvases such as the Work map.

**Acceptance:** Add focused regression coverage for every affected route/dialog; document intentional canvas scrolling; verify no page-level horizontal overflow at 320px in light and dark themes.

### Work map keyboard selection does not update details

**Problem:** Selecting a different graph node with Tab and Enter updates the React Flow selected state, while the detail panel may continue to show the previously selected item.

**Reproduction:** Open Work map with at least two nodes, keyboard-focus a different non-task node, press Enter, and compare its selected state and title with `.work-detail h2`.

**Expected:** Keyboard selection updates the detail panel to the selected node.

**Acceptance:** A keyboard regression test verifies selection and displayed detail stay synchronized across two nodes, without fixed sleeps.

### Work map `nested-interactive` accessibility violation

**Problem:** axe reports `nested-interactive` for focusable descendants inside the `.work-canvas` element with `role="img"`.

**Reproduction:** Run the Work map audit case and inspect its axe violation details.

**Expected:** The graph exposes an accessible interaction model without nested interactive semantics or hidden keyboard controls.

**Acceptance:** Resolve the violation while preserving keyboard navigation; add automated coverage for the chosen accessible semantics and verify with axe.

### Overview keyboard navigation reaches BODY sentinel

**Problem:** After the final Overview body target, keyboard traversal reaches Chromium's BODY sentinel, which the audit currently treats as a product finding outside modal focus-boundary cases.

**Reproduction:** Open Overview and press Tab through the navigation and body targets while recording `document.activeElement`.

**Expected:** Keyboard focus proceeds through meaningful, visible page targets and does not land on an unintended BODY sentinel.

**Acceptance:** Add a deterministic focus-order regression test for Overview and verify forward and reverse traversal at desktop and mobile viewports.
