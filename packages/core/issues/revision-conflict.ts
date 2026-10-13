/**
 * The server's optimistic-concurrency refusal, as a rule rather than as a
 * per-surface string comparison.
 *
 * Two writers can hold the same comment or issue at once, and the server only
 * refuses the second one when the request says what it was editing from. Both
 * gates exist on the live deployment and both answer with the same envelope
 * (`server/internal/handler/handler.go`):
 *
 *   writeRevisionConflict → 409 {code:"revision_conflict", resource_type,
 *                                expected_revision, actual_revision}
 *   writeEditConflict     → 409 {code:"revision_conflict", resource_type}
 *
 * The second shape carries no revisions because the check was a field
 * baseline (`content_base`, `title_base`) rather than the aggregate token — the
 * field had already moved on, so there is no pair of numbers to report.
 *
 * This module exists because the refusal has to be told apart from the other
 * 409s the same endpoints emit. `PUT /api/issues/:id` also answers 409 when the
 * target status was archived mid-flight, and `duplicate_target_is_duplicate` /
 * `issue_has_duplicates` are 409s too — three different situations, three
 * different sentences, one status code. Branching on the status alone shows
 * every one of them as "someone else edited this".
 *
 * The code is read off the body by hand rather than through
 * `errorCode` (`packages/core/api/client.ts`). That helper is `instanceof
 * ApiError` against THIS package's class, and the mobile app owns its own
 * transport and its own `ApiError` (`apps/mobile/data/api.ts`), so every mobile
 * failure reaches it as `undefined`. A rule the mobile client binds to cannot
 * depend on a class identity the mobile client never constructs.
 */

/** The stable code both conflict writers attach. */
export const REVISION_CONFLICT_CODE = "revision_conflict";

/** Which resource the refused write targeted. */
export type RevisionConflictResource = "comment" | "issue" | string;

export interface RevisionConflict {
  /** `comment` or `issue`, as the server named it; a string for forward compat. */
  resourceType: RevisionConflictResource;
  /** The revision the caller claimed, on the aggregate-token shape only. */
  expectedRevision?: number;
  /** The revision the server actually holds, on the aggregate-token shape only. */
  actualRevision?: number;
}

/**
 * The `code` a failure body carries, or `null`.
 *
 * Duck-typed for the same reason `lib/write-failure.ts` duck-types on `status`:
 * this module is shared with the mobile app, which throws its own error class.
 * Reading the field directly is what makes the rule class-agnostic, and a
 * non-string or blank code reads as absent rather than being coerced into a
 * match.
 */
export function errorCodeOf(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const body = (err as { body?: unknown }).body;
  if (typeof body !== "object" || body === null) return null;
  const code = (body as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

/** Whether a failure body carries the code a test asks about. */
function hasCode(err: unknown, code: string): boolean {
  return errorCodeOf(err) === code;
}

/** The HTTP status a failure came with, or `null` when it has none. */
function statusOf(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

/**
 * Whether a failure is the server refusing a write because the resource moved.
 *
 * Both halves of the server's contract are required, and the rule therefore
 * fails CLOSED. A body carrying the code but not a 409 — an echo, a wrapped
 * response, a shape that only looks right — is reported as "not a conflict",
 * which costs the member a more generic failure line. The opposite mistake
 * costs them a claim about a race that never happened, on a write that is
 * refused either way: the gate fields are sent regardless, so a misclassified
 * conflict can never become a silent overwrite.
 *
 * The code is what distinguishes this from the OTHER 409s on the same
 * endpoints (the status-archive race, the duplicate-mark refusals). Branching
 * on the status alone would show all of them as a lost update, telling the
 * member to compare versions that never diverged.
 */
export function isRevisionConflict(err: unknown): boolean {
  return statusOf(err) === 409 && hasCode(err, REVISION_CONFLICT_CODE);
}

/**
 * Whether a failure is the server refusing a DUPLICATE MARK (MUL-7349).
 *
 * Same status, adjacent feature, opposite advice: one says "refresh and
 * compare", the other says "change the target". Kept here, next to
 * `isRevisionConflict`, so the two can never be conflated by a caller that
 * reached for the status code instead.
 */
export function isDuplicateMarkConflict(err: unknown): boolean {
  return (
    statusOf(err) === 409 &&
    (hasCode(err, "duplicate_target_is_duplicate") ||
      hasCode(err, "issue_has_duplicates"))
  );
}

/** A finite integer, or `undefined` — a malformed count must not surface as
 *  `NaN` in a message that says "expected 1, got NaN". */
function revisionOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

/**
 * The conflict as data, or `null` when this failure is something else.
 *
 * Callers that only need the yes/no answer use `isRevisionConflict`; this is for
 * the surfaces that render the two versions, which need to know whether the
 * server named a resource type.
 */
export function parseRevisionConflict(err: unknown): RevisionConflict | null {
  if (!isRevisionConflict(err)) return null;
  const body = (err as { body?: unknown }).body;
  const record =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const resourceType = record.resource_type;
  return {
    resourceType:
      typeof resourceType === "string" && resourceType.length > 0
        ? resourceType
        : "unknown",
    expectedRevision: revisionOf(record.expected_revision),
    actualRevision: revisionOf(record.actual_revision),
  };
}
