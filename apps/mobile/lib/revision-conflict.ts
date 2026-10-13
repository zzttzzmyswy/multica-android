/**
 * Mobile's binding for the server's optimistic-concurrency refusal (MYS-2132).
 *
 * The RULE lives in `@multica/core/issues/revision-conflict` and is not
 * restated here — same split as `lib/issue-duplicates.ts` against
 * `packages/core/issues/duplicates.ts`. This module adds only what is
 * mobile-specific: which sentence to show, and what the two recovery actions
 * mean.
 *
 * ## Why the recovery is not web's two-column diff
 *
 * Web answers a conflict with `RevisionConflictCompare`, a side-by-side
 * `server_version` / `local_version` panel with one action per column. Mobile
 * deliberately does not. A phone gives a comment body roughly 300dp of usable
 * width; two columns of Markdown at that width are each narrower than the
 * gutter of the layout web renders them in, so the comparison would show two
 * unreadable slivers of text and the member would still have to tap one to
 * find out what it said. The information the panel carries is "these differ,
 * pick one" — which an alert states in one line and one tap.
 *
 * What mobile keeps from web, because it is the part that matters:
 *
 *  - the conflict is classified SEPARATELY from a generic failure, with web's
 *    own wording (`revision.conflict`);
 *  - the member chooses, and BOTH choices are available — adopting the server's
 *    version or keeping their own;
 *  - nothing is discarded on the member's behalf while they decide. The draft
 *    stays in the editor behind the alert.
 *
 * What mobile drops is the inline diff, and that is a real loss: on a comment
 * with a small change the member cannot see WHAT changed without dismissing the
 * alert and re-reading the refreshed body. That is the tradeoff, and the
 * alternative — an unreadable two-column panel — is worse on this form factor.
 *
 * ## Reading the token
 *
 * `revisionForEdit` is the one place that decides whether a write can be
 * gated. A server that predates the field sends no revision, and the honest
 * answer there is "ungated" (last-write-wins, as before) rather than a
 * synthesised 0: the server rejects `expected_revision < 1` outright, so
 * inventing a value turns a working edit into a 400.
 */

import {
  isDuplicateMarkConflict,
  isRevisionConflict,
  parseRevisionConflict,
} from "@multica/core/issues/revision-conflict";

export { isRevisionConflict, parseRevisionConflict };

/** i18n id shown in place of a generic failure line on a lost update. */
export const REVISION_CONFLICT_KEY = "revision.conflict";

/**
 * The token to send as `expected_revision`, or `undefined` to send no gate.
 *
 * Takes the value off whichever row the editor was opened against. `undefined`
 * for a missing, non-finite or non-positive value — all three mean "this build
 * cannot gate the write", and all three would otherwise produce a request the
 * server refuses with a 400 rather than a 409.
 */
export function revisionForEdit(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return undefined;
  }
  return value;
}

/** What the member chose when told the row had moved on. */
export type RevisionConflictChoice = "useServer" | "keepLocal";

/** The two recovery actions, in the order they are offered.
 *
 *  "Use the latest version" is listed first and marked non-destructive: it is
 *  the safe answer, and it is the one that cannot lose anyone else's work.
 *  "Keep my version" overwrites whatever the other writer saved, so it carries
 *  the destructive style — the same split web's panel makes between its
 *  `use_server` and `keep_local` buttons.
 */
export function revisionConflictActions(): {
  choice: RevisionConflictChoice;
  labelKey: string;
  destructive: boolean;
}[] {
  return [
    { choice: "useServer", labelKey: "revision.useServer", destructive: false },
    { choice: "keepLocal", labelKey: "revision.keepLocal", destructive: true },
  ];
}

/**
 * Whether a failure needs the duplicate-mark explanation rather than the
 * lost-update one.
 *
 * Both arrive as 409s on `PUT /api/issues/:id`. Without this the member who
 * picked an illegal duplicate target would be told to "refresh and compare
 * versions", which names a race that never happened and hides the actual
 * instruction (pick the original instead).
 */
export function isDuplicateMarkConflictError(err: unknown): boolean {
  return isDuplicateMarkConflict(err);
}

/**
 * Whether an edit failed because someone else changed the row first.
 *
 * The single predicate every mobile write surface asks, so the classification
 * cannot drift between the comment editor and the issue editor.
 */
export function isRevisionConflictError(err: unknown): boolean {
  return isRevisionConflict(err);
}
