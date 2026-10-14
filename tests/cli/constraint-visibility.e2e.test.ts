/**
 * #14 (C-B): confirmed constraints recorded by init have no match scope, so context and review never use them.
 * status, doctor and review now say so. Verdicts, claims and exit codes do not change, and a constraint with a
 * match scope is not reported.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { duoctl, existingProject } from "./support.js";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });
const temps: string[] = [];
afterAll(() => temps.forEach((t) => fs.rmSync(t, { recursive: true, force: true })));

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- parsed CLI JSON
type Json = any;
const IDS = ["CON-001", "CON-002"];
const NOT_CHECKED = "Constraints not checked: CON-001, CON-002";

describe("#14: unscoped confirmed constraints are named, not silently passed", () => {
  const p = existingProject(temps);
  const constraintsFile = path.join(p.root, ".duo-project", "intent", "constraints.yaml");
  const review = () => {
    const r = duoctl(p.root, ["review", "--json"]);
    expect(r.code).toBe(0);
    return r.json().result as Json;
  };
  const comparable = (r: Json) => ({ verdict: r.verdict, claims: r.claims, gaps: r.gaps, limitations: r.limitations.filter((l: Json) => l.code !== "constraints-unscoped") });
  let first: Json;

  it("init records the constraints; status names them in JSON and in the human output", () => {
    const answers = [{ question: "project_goal", value: "Keep recurring chores fair." }, { question: "critical_constraints", statements: ["No cloud sync", "Durations are whole minutes"] }];
    const init = duoctl(p.root, ["init", "--non-interactive", "--answers", "-", "--json"], JSON.stringify(answers));
    expect(init.code).toBe(0);
    const s = duoctl(p.root, ["status", "--json"]);
    expect(s.code).toBe(0);
    expect(s.json().result.truth).toMatchObject({ constraints: 2, unscopedConstraints: IDS });
    expect(duoctl(p.root, ["status"]).stdout).toContain(NOT_CHECKED);
  });

  it("doctor adds the IDs as a fact and a note; the check stays ok and the exit code is unchanged", () => {
    const d = duoctl(p.root, ["doctor", "--json"]);
    const check = d.json().result.checks.find((c: Json) => c.id === "truth.project");
    expect(check).toMatchObject({ status: "ok", reason: "valid", facts: { constraints: 2, unscopedConstraints: IDS } });
    const human = duoctl(p.root, ["doctor"]);
    expect(human.code).toBe(d.code);
    expect(human.stdout).toContain(NOT_CHECKED);
  });

  it("review adds the constraints-unscoped limitation and the human line; the verdict comes from the other rules", () => {
    p.edit("src/scheduler.ts", "% 7", "% 5");
    expect(duoctl(p.root, ["index"]).code).toBe(0);
    first = review();
    expect(first.status).toBe("ready");
    expect(first.limitations).toContainEqual({ code: "constraints-unscoped", message: expect.stringContaining("CON-001, CON-002") });
    const human = duoctl(p.root, ["review"]);
    expect(human.stdout).toContain("constraints-unscoped");
    expect(human.stdout).toContain("CON-001, CON-002: confirmed constraints without a match scope; this review did not check them");
  });

  it("a constraint with a match scope is not reported, and the verdict and claims stay the same", () => {
    const text = fs.readFileSync(constraintsFile, "utf8");
    fs.writeFileSync(constraintsFile, text.replace("enforcement: warn", "enforcement: warn\n    match:\n      paths:\n        - src/**"));
    expect(duoctl(p.root, ["index"]).code).toBe(0);
    expect(duoctl(p.root, ["status", "--json"]).json().result.truth.unscopedConstraints).toEqual(["CON-002"]);
    const second = review();
    expect(second.limitations).toContainEqual({ code: "constraints-unscoped", message: expect.stringContaining("(CON-002)") });
    // As before #14, a scoped constraint is related to the change and gets an UNKNOWN constraint-compliance claim
    // (its meaning needs a semantic check); it never changes the verdict.
    expect(second.verdict).toBe(first.verdict);
    expect(second.claims.filter((c: Json) => c.rule !== "constraint-compliance")).toEqual(first.claims);
    expect(second.claims.filter((c: Json) => c.rule === "constraint-compliance")).toEqual([expect.objectContaining({ subject: { kind: "constraint", id: "CON-001" }, alignment: "UNKNOWN", enforced: false })]);
    fs.writeFileSync(constraintsFile, text);
  });

  it("with no constraints at all the review is the same except for the limitation", () => {
    fs.writeFileSync(constraintsFile, "constraints: []\n");
    expect(duoctl(p.root, ["index"]).code).toBe(0);
    expect(duoctl(p.root, ["status", "--json"]).json().result.truth).toMatchObject({ constraints: 0, unscopedConstraints: [] });
    expect(duoctl(p.root, ["status"]).stdout).not.toContain("Constraints not checked");
    const none = review();
    expect(none.limitations.map((l: Json) => l.code)).not.toContain("constraints-unscoped");
    expect(comparable(none)).toEqual(comparable(first));
  });
});
