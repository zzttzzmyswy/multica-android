/**
 * What a "create another" batch continuation may keep, and when it stops
 * being a continuation at all.
 *
 * Web's MUL-7648 (`packages/core/issues/stores/draft-store.ts`,
 * `batchContinuationBaseline`) is the reference. Before it, `resetForNextIssue`
 * threw away *everything* but the assignee, so a batch of five sub-tasks under
 * one parent needed five parent picks and five status picks. It now keeps the
 * just-submitted **status** (alongside the assignee) and leaves the **parent +
 * stage** in place: filing several sub-issues under one parent at one stage is
 * the case the feature exists for.
 *
 * Keeping the status creates a second problem the web commit solves with a
 * baseline snapshot. A continuation nobody touched is *indistinguishable* from
 * a draft the user is working on — `hasDraft` alone would light the entry
 * point's dot, and the inherited status would survive a reload as if the user
 * had chosen it. So:
 *
 *   - `beginBatchContinuation` records the reset draft as a baseline.
 *   - Anything the user changes afterwards is real intent (recoverable).
 *   - An untouched continuation is normalized back to the create default when
 *     the form closes (`endBatchContinuation`) and when it is persisted.
 *
 * Two rules are easy to get wrong, and both are encoded below:
 *
 *   1. **Compare the manual form, not the whole draft.** A mode switch
 *      assist-seeds the agent prompt without the user editing the manual
 *      fields, and that must not read as "the user typed something"
 *      (`manualFormChanged` in web compares `{shared, manual}` only).
 *   2. **Status is part of what a batch inherits, not what it proves.** An
 *      untouched continuation holding the inherited status must not count as
 *      recoverable content, or every batch leaves a phantom draft behind.
 *
 * Kept pure and free of React/Native imports so the keep/clear split is
 * testable in the Node vitest lane.
 */

/**
 * The subset of a create draft a batch continuation is judged on. Structural
 * on purpose: the mobile draft store passes its own values and the tests pass
 * literals, without either importing the other.
 *
 * Mirrors web's `{ shared, manual }` comparison — the agent slot (`prompt`,
 * `agentActor`) and `mode` are deliberately absent, because a mode switch can
 * rewrite them without the user editing this form.
 */
export interface BatchComparableDraft {
  title: string;
  description: string;
  status: string;
  priority: string;
  dueDate: string | null;
  startDate: string | null;
  labels: unknown[];
  project: unknown;
  propertyValues: Record<string, unknown>;
  assignee: unknown;
}

/** Fields compared in order; each one is a value-equal check. */
const COMPARED_FIELDS: ReadonlyArray<keyof BatchComparableDraft> = [
  "title",
  "description",
  "status",
  "priority",
  "dueDate",
  "startDate",
  "labels",
  "project",
  "propertyValues",
  "assignee",
];

/**
 * Value equality for one compared field.
 *
 * `labels`, `project`, `propertyValues` and `assignee` are objects that the
 * store rebuilds on every write, so identity comparison would report "changed"
 * for an untouched continuation every time. They are compared by value here.
 * A key-order difference in `propertyValues` must not count as an edit either
 * — the user does not control insertion order.
 */
function fieldEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || a === undefined || b === undefined) {
    // `null` and `undefined` both mean "no value" for every compared field
    // (project / assignee / due date), so they are equal to each other.
    return (a ?? null) === (b ?? null);
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((item, i) => fieldEqual(item, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const aRecord = a as Record<string, unknown>;
    const bRecord = b as Record<string, unknown>;
    const aKeys = Object.keys(aRecord);
    const bKeys = Object.keys(bRecord);
    if (aKeys.length !== bKeys.length) return false;
    // Order-insensitive: every key in A must exist in B with an equal value.
    return aKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(bRecord, key) &&
        fieldEqual(aRecord[key], bRecord[key]),
    );
  }
  return false;
}

/**
 * Whether the user changed the manual form since the continuation began.
 *
 * Web's `manualFormChanged`. An untouched continuation — which only inherits
 * the submitted status and assignee — reads `false`; any real edit reads
 * `true`, and that is what makes the draft worth recovering.
 */
export function batchFormChanged(
  current: BatchComparableDraft,
  baseline: BatchComparableDraft,
): boolean {
  return COMPARED_FIELDS.some(
    (field) => !fieldEqual(current[field], baseline[field]),
  );
}

/**
 * Whether the draft still holds the status it only *inherited* from the batch.
 *
 * Only an untouched continuation does. Once the user changes anything (the
 * status included, or e.g. a title) the status stops being inherited and is
 * kept as-is. Web's `hasInheritedStatus`.
 */
export function hasInheritedStatus(
  current: BatchComparableDraft,
  baseline: BatchComparableDraft | null | undefined,
): boolean {
  if (!baseline) return false;
  return !batchFormChanged(current, baseline);
}

/**
 * The status a continuation should hold once it is no longer live: when it is
 * written to disk, and when the form closes.
 *
 * Web encodes the same rule twice (its persist `partialize` and
 * `endBatchContinuation`) — one function here, because two copies of
 * "normalize an untouched continuation" is two chances for them to disagree.
 * An untouched continuation drops the inherited status so the next *fresh*
 * dialog starts from the create default; a continuation the user actually
 * edited keeps everything it holds.
 *
 * `defaultStatus` is passed in rather than imported so this module stays free
 * of the store's defaults; the caller owns that constant.
 */
export function normalizedBatchStatus<S extends string>(
  current: BatchComparableDraft,
  baseline: BatchComparableDraft | null | undefined,
  defaultStatus: S,
): string {
  return hasInheritedStatus(current, baseline) ? defaultStatus : current.status;
}

/**
 * Whether the entry point should show the "unfinished draft" dot.
 *
 * Web's `hasRecoverableIntent`: real content, OR a change away from the
 * untouched continuation. The second half is what makes a batch survivable —
 * a user who typed nothing loses nothing, and a user who typed anything keeps
 * it.
 */
export function hasRecoverableIntent(
  current: BatchComparableDraft,
  baseline: BatchComparableDraft | null | undefined,
  hasContent: boolean,
): boolean {
  if (hasContent) return true;
  if (!baseline) return false;
  return batchFormChanged(current, baseline);
}
