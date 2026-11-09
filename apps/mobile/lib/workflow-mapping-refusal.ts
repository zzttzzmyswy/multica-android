/**
 * The one refusal a project-workflow switch can earn, and the plan it carries
 * (MUL-7420, MYS-2690).
 *
 * ## Why this needs its own reader
 *
 * `POST /api/projects/{id}/workflow` answers a missing destination with
 * `409 workflow_status_mapping_required` and a body of
 *
 *   { code, error: "<agent-facing sentence>", plan: { required: […], … } }
 *
 * (`writeMappingRequired`, `server/internal/handler/issue_workflow.go:596`).
 * The sentence is written for a program — `choose a destination status for the
 * 2 issue(s) on "drafting"` — and dropping it into the generic write-failure
 * alert tells the user nothing they can act on: not which statuses, not how
 * many issues, not that the dialog they were just in can supply the answer.
 *
 * So the failure is read here instead. Two outcomes matter, and they lead to
 * different actions:
 *
 *   - {@link kind} `"mapping_required"` — the plan is in the body. The caller
 *     re-opens the mapping dialog pre-filled from it, which is the recovery
 *     web offers (`project-workflow-row.tsx:70-80` re-reads the plan it already
 *     had; mobile has to re-read it from the refusal because the 409 means the
 *     local plan was stale or never fetched).
 *   - `null` — every other failure (403 not-a-lead, 400 bad id, 500, network)
 *     keeps the generic channel. Returning a refusal for those would hide a
 *     real error behind a plausible sentence, so the code match is exact.
 *
 * Pure: duck-typed on the error's body, no `@/data/api` import, so the Node
 * lane holds the parsing down — the same split as
 * `lib/workflow-write-refusal.ts`.
 */
import type { IssueWorkflowMappingPlan } from "@multica/core/types";

export const WORKFLOW_STATUS_MAPPING_REQUIRED_CODE = "workflow_status_mapping_required";

export type ProjectWorkflowWriteRefusal = {
  kind: "mapping_required";
  /** The plan the server wants satisfied, already normalised. */
  plan: IssueWorkflowMappingPlan;
  /** The server's own sentence. Not shown to users — it names raw status
   *  keys — but carried so a log or a support report has it. */
  detail: string;
};

function bodyOf(error: unknown): Record<string, unknown> | null {
  if (typeof error !== "object" || error === null) return null;
  const body = (error as { body?: unknown }).body;
  if (typeof body !== "object" || body === null) return null;
  return body as Record<string, unknown>;
}

function numberOr(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringOr(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function requirementsOf(value: unknown): IssueWorkflowMappingPlan["required"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (typeof row !== "object" || row === null) return [];
    const record = row as Record<string, unknown>;
    const statusKey = stringOr(record.status_key);
    if (!statusKey) return [];
    return [
      {
        status_key: statusKey,
        issue_count: numberOr(record.issue_count),
        suggested_status_key: stringOr(record.suggested_status_key),
      },
    ];
  });
}

function unchangedOf(value: unknown): IssueWorkflowMappingPlan["unchanged"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (typeof row !== "object" || row === null) return [];
    const record = row as Record<string, unknown>;
    const statusKey = stringOr(record.status_key);
    if (!statusKey) return [];
    return [{ status_key: statusKey, issue_count: numberOr(record.issue_count) }];
  });
}

function planOf(value: unknown): IssueWorkflowMappingPlan {
  const record =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return {
    required: requirementsOf(record.required),
    unchanged: unchangedOf(record.unchanged),
    total_issues: numberOr(record.total_issues),
    affected_issues: numberOr(record.affected_issues),
  };
}

/**
 * Reads the mapping refusal out of a failed switch, or `null` for every other
 * failure.
 *
 * A `409` whose body carries neither the code nor a plan is NOT a mapping
 * refusal: the endpoint has exactly one other conflict source (a lost update
 * on the project row), and that one has nothing to map. Requiring the code
 * keeps the two apart.
 */
export function projectWorkflowWriteRefusal(
  error: unknown,
): ProjectWorkflowWriteRefusal | null {
  const body = bodyOf(error);
  if (!body) return null;
  if (body.code !== WORKFLOW_STATUS_MAPPING_REQUIRED_CODE) return null;
  const plan = planOf(body.plan);
  // A refusal that names no status is not actionable — the whole point of the
  // recovery is the dialog's rows. Treat it as an ordinary failure rather than
  // re-opening an empty dialog the user cannot satisfy.
  if (plan.required.length === 0) return null;
  return {
    kind: "mapping_required",
    plan,
    detail: stringOr(body.error),
  };
}
