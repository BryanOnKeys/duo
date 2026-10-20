/**
 * Decision read API (BE-API-02, T95): the Decision list and one Decision with its lock status and
 * supersession chain, for the local UI. Read-only: it loads Project Truth, computes what the files say and
 * writes nothing. Every field comes from the Decision files as they are now; nothing is inferred from Git
 * history, and no field claims more than the files show:
 *
 * - "lockStatus" is verifyDecisionLock(): the recorded digest against the content (valid, missing,
 *   mismatch, not-confirmed). A valid lock is evidence of the confirm workflow, not an authentication
 *   (ADR-013, docs/10-security.md): a recomputed digest cannot be told apart.
 * - "origin" is "lifecycle" when a confirmed or superseded Decision carries a lock, "manual" when it has none
 *   (the ADR-013 manual fallback), null when it is not confirmed.
 * - "confirmedBy" and "proposedBy" are the labels written in the file. They are not identities.
 * - "integrity" lists the loader's error diagnostics for that Decision (lock mismatch, lifecycle problems,
 *   H-82); "truth.complete" is false when any blocking Truth error exists, in which case review, context and
 *   the Decision lifecycle refuse to decide (requireCompleteTruth, H-75).
 *
 * No role or Team Mode check is made here (ADR-015 is not approved).
 */
import {
  compareUtf8, STATE_DIR_NAME, truthAuthorityErrors, verifyDecisionLock, type Decision, type Diagnostic, type LockVerification, type SourceLocation,
} from "@duo-director/core";
import { guarded, project, type Failure, type Operation } from "../operations/common.js";
import { decisionLabel } from "./projection.js";

export type DecisionStateFilter = Decision["state"];
export interface DecisionListQuery { readonly state?: DecisionStateFilter; readonly q?: string }

export interface TruthProblem { readonly code: string; readonly message: string; readonly path?: string; readonly line?: number }
export interface TruthHealth { readonly complete: boolean; readonly problems: readonly TruthProblem[] }

const MAX_CHAIN = 64;

const loc = (l: SourceLocation) => ({ path: l.path, ...(l.startLine === undefined ? {} : { startLine: l.startLine }), ...(l.endLine === undefined ? {} : { endLine: l.endLine }) });

/** A diagnostic as the UI may show it: no absolute path of this machine. */
function problemOf(root: string, d: Diagnostic): TruthProblem {
  const forms = [...new Set([root, root.replaceAll("\\", "/"), root.replaceAll("/", "\\")])].filter((f) => f.length > 1);
  let message = d.message;
  for (const f of forms) message = message.split(f).join("<repository>");
  return { code: d.code, message, ...(d.source?.path === undefined ? {} : { path: d.source.path }), ...(d.source?.startLine === undefined ? {} : { line: d.source.startLine }) };
}

function truthHealth(root: string, diagnostics: readonly Diagnostic[]): TruthHealth {
  const errors = diagnostics.filter((d) => d.severity === "error");
  return { complete: truthAuthorityErrors(diagnostics).length === 0, problems: errors.map((d) => problemOf(root, d)) };
}

/** Error diagnostics about one Decision: its own file, or a message that names it first ("D-001: ..."). */
function problemsOf(root: string, d: Decision, diagnostics: readonly Diagnostic[]): TruthProblem[] {
  const ownFile = d.location.path === STATE_DIR_NAME + "/decisions/" + d.id + ".yaml";
  return diagnostics
    .filter((x) => x.severity === "error" && (x.message.startsWith(d.id + ":") || (ownFile && x.source?.path === d.location.path)))
    .map((x) => problemOf(root, x));
}

function summaryOf(root: string, d: Decision, diagnostics: readonly Diagnostic[]) {
  const lock = verifyDecisionLock(d).value;
  const lifecycle = d.state === "confirmed" || d.state === "superseded";
  const problems = problemsOf(root, d, diagnostics);
  return {
    id: d.id, title: d.title, kind: d.decisionKind, state: d.state, authority: decisionLabel(d), enforcement: d.enforcement ?? null,
    locked: d.lock !== undefined, lockStatus: lock.status, origin: lifecycle ? (d.lock === undefined ? "manual" : "lifecycle") : null,
    supersedes: d.supersedes, supersededBy: d.supersededBy,
    ...(d.proposalId === undefined ? {} : { proposalId: d.proposalId }),
    ...(d.confirmedAt === undefined ? {} : { confirmedAt: d.confirmedAt }), ...(d.confirmedBy === undefined ? {} : { confirmedBy: d.confirmedBy }),
    integrity: problems.length === 0 ? "ok" as const : "invalid" as const, problems,
    location: loc(d.location),
  };
}

/** The supersession chain through id, oldest first. A missing Decision or a loop ends the walk and is marked. */
function chainOf(d: Decision, byId: ReadonlyMap<string, Decision>) {
  type Link = { readonly id: string; readonly state?: string; readonly authority?: string; readonly missing?: true; readonly loop?: true };
  const node = (x: Decision): Link => ({ id: x.id, state: x.state, authority: decisionLabel(x) });
  const seen = new Set([d.id]);
  const back: Link[] = [];
  for (let at = d.supersedes; at !== null && back.length < MAX_CHAIN;) {
    if (seen.has(at)) { back.push({ id: at, loop: true }); break; }
    seen.add(at);
    const x = byId.get(at);
    if (x === undefined) { back.push({ id: at, missing: true }); break; }
    back.push(node(x));
    at = x.supersedes;
  }
  const forward: Link[] = [];
  for (let at = d.supersededBy; at !== null && forward.length < MAX_CHAIN;) {
    if (seen.has(at)) { forward.push({ id: at, loop: true }); break; }
    seen.add(at);
    const x = byId.get(at);
    if (x === undefined) { forward.push({ id: at, missing: true }); break; }
    forward.push(node(x));
    at = x.supersededBy;
  }
  return [...back.reverse(), node(d), ...forward];
}

/** GET /api/decisions: every Decision the loader read (ID order), optionally by state or a text match. */
export function projectDecisionList(root: string, query: DecisionListQuery = {}): Promise<Operation<Record<string, unknown>>> {
  return guarded<Record<string, unknown>>(async () => {
    const p = project(root);
    if (p.value === undefined) return p.outcome as Failure;
    const diagnostics = p.diagnostics ?? [];
    const needle = query.q?.toLowerCase();
    const decisions = [...p.value.truth.decisions]
      .sort((a, b) => compareUtf8(a.id, b.id))
      .filter((d) => query.state === undefined || d.state === query.state)
      .filter((d) => needle === undefined || d.id.toLowerCase().includes(needle) || d.title.toLowerCase().includes(needle))
      .map((d) => summaryOf(root, d, diagnostics));
    return { kind: "ok", diagnostics: [], payload: { decisions, actorLabelsAuthenticated: false, truth: truthHealth(root, diagnostics) } };
  });
}

/** GET /api/decisions/{id}: one Decision with its content, lock verification and supersession chain, or not-found. */
export function projectDecisionDetail(root: string, id: string): Promise<Operation<Record<string, unknown>>> {
  return guarded<Record<string, unknown>>(async () => {
    const p = project(root);
    if (p.value === undefined) return p.outcome as Failure;
    const diagnostics = p.diagnostics ?? [];
    const truth = truthHealth(root, diagnostics);
    const byId = new Map<string, Decision>();
    for (const d of p.value.truth.decisions) if (!byId.has(d.id)) byId.set(d.id, d);
    const d = byId.get(id);
    if (d === undefined) return { kind: "ok", diagnostics: [], payload: { status: "not-found", id, truth } };
    const lock: LockVerification = verifyDecisionLock(d).value;
    return {
      kind: "ok", diagnostics: [],
      payload: {
        status: "found", id,
        decision: {
          ...summaryOf(root, d, diagnostics),
          question: d.question, answer: d.answer, rationale: d.rationale ?? null, governs: d.governs, forbids: d.forbids,
          ...(d.proposedAt === undefined ? {} : { proposedAt: d.proposedAt }), ...(d.proposedBy === undefined ? {} : { proposedBy: d.proposedBy }),
          ...(d.proposedByKind === undefined ? {} : { proposedByKind: d.proposedByKind }),
          lock, chain: chainOf(d, byId),
        },
        actorLabelsAuthenticated: false, truth,
      },
    };
  });
}
