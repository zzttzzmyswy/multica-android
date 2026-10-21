/**
 * The "which issues is an agent working on right now" projection, used by the
 * issue-list surfaces to filter on it and by every row badge to decide whether
 * to render.
 *
 * The predicate itself lives in core
 * (`@multica/core/issues/surface/issue-activity`) because web draws the same
 * line in `packages/views/issues/surface/activity.ts` and mobile cannot import
 * `@multica/views`. Re-exported here so the mobile call sites keep their
 * existing import path and the mobile guard test keeps exercising it through
 * the path the app actually uses.
 */
export { deriveRunningIssueIds } from "@multica/core/issues/surface/issue-activity";

/**
 * The FULL projection — running and queued alike — for surfaces that ask "is
 * anyone going to work on this", not "is anyone on it now". The inbox's idle
 * dimension is the one caller: web reads it off `activityByIssueId`'s key set,
 * queued included, so sharing the running-only projection above would make a
 * just-dispatched issue read as idle on the phone.
 */
export { deriveIssueSurfaceActivity } from "@multica/core/issues/surface/issue-activity";
