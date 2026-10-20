/**
 * What "create another" keeps and what it throws away.
 *
 * Web's `resetForNextIssue` (`packages/views/modals/create-issue.tsx:391-424`)
 * is the reference. Reading it line by line gives one rule that is easy to
 * miss and expensive to get wrong:
 *
 *   **The assignee survives; the parent does not.**
 *
 * Web keeps `assigneeType` / `assigneeId` (`:406-414` — the comment says
 * "Keep the just-used assignee for the next issue in the batch") but clears
 * the parent (`:401`) and the project (`:400`). That asymmetry is the whole
 * point of batching: five tasks for the same person is the common case, and
 * re-picking them five times is what the feature exists to avoid. A sub-task
 * queue, by contrast, is not a batch — carrying the parent forward would file
 * unrelated tasks under somebody else's sub-task tree. Project is cleared for
 * the same reason web's quick-create store refuses to remember it at all
 * (`quick-create-store.test.ts`, MUL-5862): a project belongs to the issue
 * being filed, not to the person filing it.
 *
 * Everything else is "the *content* of this issue" and must go: title,
 * description, prompt, status (back to todo), priority (back to none), dates,
 * labels, custom-property values, attachments, and the stage pick (which is
 * relative to the parent that was just cleared).
 *
 * Kept pure and separate from the screen so the interesting part — the
 * keep/clear split — is testable and mutable without a renderer.
 */

import type { IssuePropertyValues } from "@multica/core/types";

/**
 * The subset of the draft a "create another" has to rewrite. Mirrors the
 * mobile draft store's settable fields; deliberately structural so the screen
 * can pass its own store's snapshot.
 */
export interface NextIssueDraftReset {
  title: string;
  description: string;
  prompt: string;
  status: string;
  priority: string;
  dueDate: string | null;
  startDate: string | null;
  labels: unknown[];
  propertyValues: IssuePropertyValues;
  /** `undefined` clears it — a batch has no shared project. */
  project: undefined;
  /** `undefined` clears it — a batch is not a sub-task queue. */
  parentIssueId: undefined;
}

/**
 * Build the draft for the next issue in a batch, given the one just
 * submitted. Mirrors web's `resetForNextIssue`, restricted to the fields
 * mobile's draft store holds.
 *
 * `assignee` is intentionally NOT in the returned shape: the caller leaves it
 * untouched. It is called out here — and in the exporter's tests — because
 * "clear everything" is the obvious-looking implementation and it silently
 * removes the feature's main benefit.
 */
export function nextIssueDraftReset(
  current: {
    assignee: unknown;
    stage: number | null;
  },
): NextIssueDraftReset {
  // `current` is accepted so a future rule (e.g. carrying the current mode
  // forward) has somewhere to read from without a signature change, and so
  // the caller cannot claim it built the reset without looking at what was
  // submitted. Nothing in today's rules depends on it beyond the two fields
  // documented above, which the caller applies itself.
  void current;
  return {
    title: "",
    description: "",
    prompt: "",
    status: "todo",
    priority: "none",
    dueDate: null,
    startDate: null,
    labels: [],
    propertyValues: {},
    project: undefined,
    parentIssueId: undefined,
  };
}

/**
 * Whether a submit should keep the form open.
 *
 * Trivial on its own, but factored out so the call site cannot accidentally
 * invert it — "keep open" and "close" look equally plausible in a ternary and
 * a flipped branch is silent (the user just sees the form vanish, or stay).
 */
export function shouldKeepFormOpen(keepOpen: boolean): boolean {
  return keepOpen === true;
}
