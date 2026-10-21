/**
 * Proposal preview read API (BE-API-05, T95): GET /api/proposals/{id}/preview returns exactly what
 * DecisionService.previewConfirm() returns for one pending proposal: the same candidate reading confirm uses
 * and the same digest /api/proposals shows, so the digest can be sent as the confirm request's previewDigest.
 * Read-only: previewConfirm takes no lock, writes nothing and repairs nothing. A changed proposal, superseded
 * target or Project Truth gives a different digest, and confirm with the old one is refused
 * (DECISION_CONFIRM_PREVIEW_CHANGED). No role or Team Mode check is made here (ADR-015 is not approved).
 */
import { createDecisionService, type Diagnostic } from "@duo-director/core";

/** A diagnostic as the UI may show it: no absolute path of this machine. */
function shown(root: string, d: Diagnostic) {
  const forms = [...new Set([root, root.replaceAll("\\", "/"), root.replaceAll("/", "\\")])].filter((f) => f.length > 1);
  let message = d.message;
  for (const f of forms) message = message.split(f).join("<repository>");
  return { code: d.code, message, ...(d.source?.path === undefined ? {} : { path: d.source.path }) };
}

/** data of duo.ui.preview/1: ready with the preview, not-initialized, or failed with the service's diagnostics. */
export async function projectProposalPreview(root: string, id: string): Promise<Record<string, unknown>> {
  const r = await createDecisionService({ root }).previewConfirm(id);
  if (r.value !== undefined) return { status: "ready", preview: r.value, warnings: r.diagnostics.map((d) => shown(root, d)) };
  if (r.diagnostics.some((d) => d.code === "PROJECT_FILE_MISSING")) return { status: "not-initialized", message: "Not a DUO project yet: run duoctl init" };
  return { status: "failed", diagnostics: r.diagnostics.map((d) => shown(root, d)) };
}
