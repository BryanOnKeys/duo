/**
 * #16: for a forbidden import in a new file, the evidence range is the diff hunk (the whole file), so the human review
 * output also shows the claim's observed text with the exact file and line. --json is unchanged.
 */
import fs from "node:fs";
import { createDecisionService } from "@duo-director/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { duoctl, existingProject, type Project } from "./support.js";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });
const temps: string[] = [];
afterAll(() => temps.forEach((t) => fs.rmSync(t, { recursive: true, force: true })));

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- parsed CLI JSON
type Json = any;
const D001 = "id: D-001\ntitle: No legacy-db imports\nkind: decision\nstate: proposed\nquestion: legacy_db\nanswer: Code does not import src/db/legacy-db.ts\nforbids:\n  imported_paths: [\"src/db/legacy-db.ts\"]\nenforcement: block\n";
// The forbidden import is on line 3 of a new five-line file.
const PAGE = "// Customer history page.\n\nimport { LegacyDb } from \"../db/legacy-db.js\";\n\nexport const rows = new LegacyDb().run(\"x\");\n";

describe("#16: the human review output names the offending line", () => {
  let p: Project;
  beforeAll(async () => {
    p = existingProject(temps);
    p.write("src/db/legacy-db.ts", "export class LegacyDb {\n  run(sql: string): string[] {\n    return [sql];\n  }\n}\n");
    p.git("add", "-A");
    p.git("commit", "-qm", "legacy db");
    expect(duoctl(p.root, ["init", "--non-interactive", "--answers", "-", "--json"], JSON.stringify([{ question: "project_goal", value: "Keep recurring chores fair." }])).code).toBe(0);
    p.git("add", "-A");
    p.git("commit", "-qm", "adopt DUO");
    p.write(".duo-project/decisions/D-001.yaml", D001);
    expect((await createDecisionService({ root: p.root }).confirm({ kind: "human", name: "Ada Lovelace" }, "D-001")).value?.decisionId).toBe("D-001");
    p.git("add", "-A");
    p.git("commit", "-qm", "confirm D-001");
    p.write("src/ui/customer-history-page.ts", PAGE);
    expect(duoctl(p.root, ["index"]).code).toBe(0);
  });

  it("the CONFLICT claim shows observed with file:line; the evidence pointers and the JSON stay as they were", () => {
    const json = duoctl(p.root, ["review", "--json"]).json().result as Json;
    expect(json.verdict).toBe("BLOCK");
    const claim = json.claims.find((c: Json) => c.rule === "decision-forbids-import");
    expect(claim.observed).toBe("forbidden import on a changed line: src/ui/customer-history-page.ts:3 import \"../db/legacy-db.js\" resolves to src/db/legacy-db.ts");
    // The hunk evidence still covers the whole new file (lines 1-5): that is the diff, kept as it is.
    const pointers = claim.evidenceIds.map((id: string) => json.evidence.find((e: Json) => e.id === id).pointer);
    expect(pointers).toContainEqual(expect.objectContaining({ path: "src/ui/customer-history-page.ts", lines: [1, 5] }));

    const lines = duoctl(p.root, ["review"]).stdout.split("\n");
    const at = lines.findIndex((l) => /CONFLICT\s+decision-forbids-import\s+D-001/u.test(l));
    expect(at).toBeGreaterThanOrEqual(0);
    const below = lines.slice(at + 1, at + 4).map((l) => l.trim());
    expect(below).toContain("observed: " + claim.observed);
    expect(below.find((l) => l.startsWith("evidence: "))).toContain("src/ui/customer-history-page.ts:1-5");
    expect(below.findIndex((l) => l.startsWith("observed: "))).toBeLessThan(below.findIndex((l) => l.startsWith("evidence: ")));
  });
});
