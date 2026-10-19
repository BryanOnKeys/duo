# 45-second terminal demo: recording plan

Source: the [0.3.3 walkthrough](../examples/decision-review-0.3.3.md) verified on 2026-10-19. Record a real terminal in a new disposable repository. Do not stitch clips that were not run, and do not show private code, home directories or tokens.

| Segment | Time | What is on screen |
|---|---|---|
| Title | 0–5 s | "Human-confirmed Decisions, checked against the actual Git change" |
| Setup | 5–12 s | `npx --no-install duoctl --version` prints 0.3.3, `duoctl doctor` prints ready, `duoctl --version` in a plain shell matches (see #40) |
| Decision | 12–22 s | The P-001 proposal and the interactive confirm that prints `confirmed as D-001` |
| Violation | 22–34 s | The legacy import in `src/ui/orders.ts`, then `review --refresh --fail-on block` and the BLOCK with `src/ui/orders.ts:2` |
| Fix | 34–41 s | Remove the import, PASS |
| Limits | 41–45 s | Caption: "Not every constraint is checked. PASS ≠ bug-free. Human confirm ≠ authentication." |

Publish a text version next to any GIF or video for readers who cannot play it. A GIF is optional; no pull request should depend on one.

