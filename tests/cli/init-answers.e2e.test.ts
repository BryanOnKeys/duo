/**
 * #15: duoctl init --answers - with the shapes the README shows, and the wrong shape from the issue: a message that
 * names the question and the field, exit 1, nothing written (built CLI, subprocess).
 */
import fs from "node:fs";
import path from "node:path";
import { loadProjectTruth } from "@duo-director/core";
import { afterAll, describe, expect, it, vi } from "vitest";
import { duoctl, existingProject } from "./support.js";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });
const temps: string[] = [];
afterAll(() => temps.forEach((t) => fs.rmSync(t, { recursive: true, force: true })));

describe("#15: init answers on stdin", () => {
  it("the issue's input fails with INIT_ANSWER_INVALID naming critical_constraints and statements; nothing is written", () => {
    const p = existingProject(temps);
    const r = duoctl(p.root, ["init", "--non-interactive", "--answers", "-", "--yes", "--json"], '[{"question":"critical_constraints","value":"No legacy DB"}]');
    expect(r.code).toBe(1);
    const out = r.json();
    expect(out.result.steps.truth).toMatchObject({ status: "failed" });
    expect(out.diagnostics).toContainEqual(expect.objectContaining({ code: "INIT_ANSWER_INVALID", message: expect.stringContaining('critical_constraints needs "statements": an array of strings') }));
    expect(fs.existsSync(path.join(p.root, ".duo-project"))).toBe(false);
    const human = duoctl(p.root, ["init", "--non-interactive", "--answers", "-"], '[{"question":"critical_constraints","value":"No legacy DB"}]');
    expect(human.code).toBe(1);
    expect(human.stdout + human.stderr).toContain('{"question":"critical_constraints","statements":["No cloud sync"]}');
    expect(human.stdout + human.stderr).not.toContain("is not iterable");
  });

  it("not a list: the message shows an example", () => {
    const p = existingProject(temps);
    const r = duoctl(p.root, ["init", "--non-interactive", "--answers", "-", "--json"], '{"question":"project_goal","value":"x"}');
    expect(r.code).toBe(1);
    expect(r.json().diagnostics).toContainEqual(expect.objectContaining({ code: "CLI_USAGE_INVALID", message: expect.stringContaining('for example [{"question":"project_goal"') }));
  });

  it("the README example sets the goal, the milestone and two constraints", () => {
    const p = existingProject(temps);
    const answers = '[{"question":"project_goal","value":"Keep recurring chores fair."},\n      {"question":"current_milestone","title":"MVP"},\n      {"question":"critical_constraints","statements":["No cloud sync","Durations are whole minutes"]}]\n';
    const r = duoctl(p.root, ["init", "--non-interactive", "--answers", "-", "--json"], answers);
    expect(r.code).toBe(0);
    expect(r.json().result.apply.openQuestions).toEqual([]);
    const truth = loadProjectTruth(p.root).value?.truth;
    expect(truth?.vision).toMatchObject({ status: "confirmed" });
    expect(truth?.milestones.map((m) => m.title)).toEqual(["MVP"]);
    expect(truth?.constraints.map((c) => c.statement)).toEqual(["No cloud sync", "Durations are whole minutes"]);
  });
});
