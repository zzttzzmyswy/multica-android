/**
 * The two refusals a status write can earn from the project-workflow rules
 * (MUL-7420), and what to say about them.
 *
 * ## Why these need their own sentences
 *
 * Both arrive as ordinary HTTP failures, so without this module they reach the
 * user through the generic write-failure channel: a title like "Could not
 * update the issue" and the server's body. That is wrong in a specific way —
 * the body is written for a caller, e.g.
 * `status "drafting" is not in workflow "Content" (allowed: todo, in_progress,
 * done)`, and the user's actual question is different: *why can't I pick that,
 * and what can I pick?*
 *
 * The phone now answers the first half BEFORE the write, by offering only the
 * workflow's columns (`lib/workflow-status-scope.ts`). These sentences cover
 * the second half, and the residual races the client cannot see:
 *
 *   - `status_not_in_workflow` — the client's workflow read was stale or
 *     unread, so the write offered a column the project no longer has. The
 *     server sends `allowed_statuses`; the sentence names them, because "pick
 *     another status" is useless advice when the picker is what lied.
 *   - `workflow_step_moved` — an agent's run tried to move an issue that a
 *     human had already moved off the step that run was working on. This one
 *     is not a user error at all and must not read like one.
 *
 * Pure: duck-typed on the error's body, no `@/data/api` import, so the Node
 * lane can hold the parsing down.
 */

export const STATUS_NOT_IN_WORKFLOW_CODE = "status_not_in_workflow";
export const WORKFLOW_STEP_MOVED_CODE = "workflow_step_moved";

export type WorkflowWriteRefusal =
  | {
      kind: "status_not_in_workflow";
      workflowName: string;
      /** The keys the server says are allowed, in its order. */
      allowedStatuses: string[];
    }
  | {
      kind: "workflow_step_moved";
      /** The step the agent's run was working on. */
      step: string;
      /** Where the issue actually is now. */
      currentStatus: string;
    };

function bodyOf(error: unknown): Record<string, unknown> | null {
  if (typeof error !== "object" || error === null) return null;
  const body = (error as { body?: unknown }).body;
  if (typeof body !== "object" || body === null) return null;
  return body as Record<string, unknown>;
}

function stringOr(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/**
 * Reads a workflow refusal out of a failed write, or `null` for every other
 * failure.
 *
 * `null` is the common case and means "let the normal channel report it" — a
 * 403, a 500, or any other 400 keeps its own handling. Returning a refusal here
 * is what takes the failure off the generic path, so a false positive would
 * hide a real error behind a plausible-sounding sentence.
 */
export function workflowWriteRefusal(error: unknown): WorkflowWriteRefusal | null {
  const body = bodyOf(error);
  if (!body) return null;
  const code = body.code;
  if (code === STATUS_NOT_IN_WORKFLOW_CODE) {
    return {
      kind: "status_not_in_workflow",
      workflowName: stringOr(body.workflow_name),
      allowedStatuses: stringArray(body.allowed_statuses),
    };
  }
  if (code === WORKFLOW_STEP_MOVED_CODE) {
    return {
      kind: "workflow_step_moved",
      step: stringOr(body.step),
      currentStatus: stringOr(body.current_status),
    };
  }
  return null;
}
