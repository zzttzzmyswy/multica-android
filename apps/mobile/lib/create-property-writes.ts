/**
 * Replaying a create form's property values onto the issue it just created
 * (iteration 259, MYS-2245).
 *
 * ## Why this cannot ride along on the create request
 *
 * `POST /api/issues` has no property field. Web's create dialog therefore keeps
 * the chosen values in local draft state and, once the issue has an id, issues
 * one `PUT /api/issues/:id/properties/:propertyId` per value
 * (`packages/views/modals/create-issue.tsx:483-508`). The server assigns
 * property values per (issue, property), so there is no batch endpoint to use
 * either.
 *
 * Getting this ordering wrong is a SILENT data loss rather than an error: a
 * payload key the server ignores produces a 201 and an issue with no
 * properties, and the user only finds out the next time they open it. So the
 * fan-out lives here, in a module the Node lane can drive against a fake API,
 * instead of inline in the screen's submit handler.
 *
 * ## Failure policy (web's, deliberately)
 *
 * The issue is already committed by the time any of these run. A rejected
 * property write therefore must NOT roll the create back or make the screen
 * report "creation failed" — the user would retry and produce a duplicate. Web
 * settles every write with `Promise.allSettled` and reports only a COUNT of
 * failures (`toast_set_properties_failed {count}`). This module returns the
 * same two facts: how many landed, and the first failure for a log line.
 *
 * Why not stop at the first failure: each property is independent, and
 * aborting would silently drop the values queued behind the one that failed.
 * Why not surface each failure separately: a create with five properties and a
 * flaky read would raise five alerts for one action.
 *
 * ## Why the values are re-read from the store, not passed in
 *
 * The caller has the map in scope, but taking it as a parameter keeps this
 * function pure and testable. `createPropertyWrites` therefore only decides
 * ORDER and SHAPE; the screen decides when to call it.
 */

/** The slice of the API this module needs. `data/api.ts`'s `setIssueProperty`
 *  matches it structurally. */
export interface PropertyWriteApi {
  setIssueProperty: (
    issueId: string,
    propertyId: string,
    value: import("@multica/core/types").IssuePropertyValue,
  ) => Promise<unknown>;
}

export interface PropertyWriteOutcome {
  /** Property ids whose value was written successfully. */
  written: string[];
  /** Property ids whose write was rejected, in attempt order. */
  failed: string[];
  /** The first rejection, for the caller's log line. `undefined` when every
   *  write landed (or there was nothing to write). */
  firstError: unknown;
}

/**
 * Write every value in `values` onto `issueId`.
 *
 * Order is the map's own insertion order — the order the user picked them in —
 * so a partial failure leaves the earliest choices applied, which is what a
 * reader would expect from a form that applies top to bottom.
 *
 * An empty map is a no-op returning empty lists: an issue created with no
 * properties must not take a round trip, and the caller must not have to branch
 * on emptiness before calling.
 */
export async function writeCreatePropertyValues(
  api: PropertyWriteApi,
  issueId: string,
  values: import("@multica/core/types").IssuePropertyValues | null | undefined,
): Promise<PropertyWriteOutcome> {
  const entries = Object.entries(values ?? {});
  if (entries.length === 0 || !issueId) {
    return { written: [], failed: [], firstError: undefined };
  }

  const results = await Promise.allSettled(
    entries.map(([propertyId, value]) =>
      api.setIssueProperty(issueId, propertyId, value),
    ),
  );

  const written: string[] = [];
  const failed: string[] = [];
  let firstError: unknown;
  results.forEach((result, i) => {
    const propertyId = entries[i][0];
    if (result.status === "fulfilled") {
      written.push(propertyId);
      return;
    }
    failed.push(propertyId);
    if (firstError === undefined) firstError = result.reason;
  });

  return { written, failed, firstError };
}

/**
 * The sentence to raise when some property writes failed, or `null` when all of
 * them landed.
 *
 * Kept as a function over the OUTCOME rather than of a count so the caller
 * cannot accidentally raise "0 properties failed". Web's string is
 * `create_issue.toast_set_properties_failed` with `{count}`; mobile uses the
 * same wording so the two clients describe the same partial state.
 */
export function propertyWriteFailureMessage(
  outcome: PropertyWriteOutcome,
  t: (key: string, params?: Record<string, string | number>) => string,
): string | null {
  if (outcome.failed.length === 0) return null;
  return t("newIssue.propertiesFailed", { count: outcome.failed.length });
}
