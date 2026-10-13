/**
 * Mobile-side bindings for the duplicate-mark surface (MUL-7349).
 *
 * The RULES live in `@multica/core/issues/duplicates.ts` and are re-exported
 * here rather than re-implemented: the picker's candidate filter, the banner's
 * visibility test and the two write patches must all agree on what a mark is,
 * and a second copy is precisely how they would drift. What is genuinely
 * mobile-local is the copy — this app has no per-surface i18n namespace, so
 * the sentences come from the flat mobile bundle.
 *
 * Kept in `lib/` so the Node vitest lane covers it (vitest.config.ts includes
 * `lib/**` and `data/**` only), the same split
 * `lib/conversation-starters-mobile.ts` uses.
 */
import type { Issue, IssueDuplicates } from "@multica/core/types";
import {
  canBeDuplicateOriginal,
  duplicateTargetExclusions,
  isDuplicateIssue,
} from "@multica/core/issues/duplicates";

// Re-exported rather than re-stated: every consumer of the rules imports them
// from here (so a call site has one path to remember), while the definitions
// stay in core where web-like callers and the tests can reach them too.
export {
  DUPLICATE_STATUS,
  DUPLICATE_TARGET_IS_DUPLICATE,
  DUPLICATE_UNMARK_STATUS,
  ISSUE_HAS_DUPLICATES,
  canBeDuplicateOriginal,
  duplicateTargetExclusions,
  isDuplicateIssue,
  markDuplicatePatch,
  unmarkDuplicatePatch,
} from "@multica/core/issues/duplicates";

/** How many issues a suggestion group offers before the user types.
 *  Web's `SUGGESTION_LIMIT` (`modals/mark-duplicate-issue.tsx:24`). */
export const DUPLICATE_SUGGESTION_LIMIT = 6;

/** The two suggestion groups the picker opens with, in web's order: titles
 *  like this one's (the same bug filed twice), then issues viewed most
 *  recently (the original is usually the one that prompted the mark).
 *
 *  Carries no `heading`: the label needs a translator, and this module is the
 *  pure half the Node vitest lane covers. The route maps `key` → i18n id, so
 *  there is still exactly one place that decides what each group is called. */
export type DuplicateSuggestionGroup = {
  key: "similar" | "recent";
  issues: Issue[];
};

/**
 * Whether the "mark as duplicate" action should be offered for this issue.
 *
 * The one case worth hiding is an issue that is ALREADY a duplicate: marking a
 * duplicate is what the server refuses with `issue_has_duplicates` on the
 * other end, and the reader's remedy (pick the current original) is a
 * different action. Everything else stays offered and may be refused with a
 * sentence naming the reason: `useMarkDuplicate` maps the server's two codes to
 * their own lines.
 */
export function showMarkDuplicateAction(
  issue: Pick<Issue, "status" | "duplicate_of">,
): boolean {
  return !isDuplicateIssue(issue);
}

/**
 * The picker's suggestion groups, filtered and de-duplicated.
 *
 * `similar` wins a tie: an issue found by title AND in the recents appears once,
 * under the heading that explains why it was offered. Empty groups are dropped
 * so the sheet never renders a heading over nothing.
 */
export function duplicateSuggestionGroups(
  similar: Issue[],
  recent: Issue[],
  opts: {
    excludeIds: readonly string[];
    limit?: number;
  },
): DuplicateSuggestionGroup[] {
  const excluded = new Set(opts.excludeIds);
  const limit = opts.limit ?? DUPLICATE_SUGGESTION_LIMIT;
  const keep = (issue: Issue) =>
    !excluded.has(issue.id) && canBeDuplicateOriginal(issue);
  const similarKept = similar.filter(keep).slice(0, limit);
  const seen = new Set(similarKept.map((issue) => issue.id));
  const recentKept = recent
    .filter((issue) => !seen.has(issue.id))
    .filter(keep)
    .slice(0, limit);
  return [
    { key: "similar" as const, issues: similarKept },
    { key: "recent" as const, issues: recentKept },
  ] satisfies DuplicateSuggestionGroup[];
}

/**
 * The exclude-id set a mark picker opens with.
 *
 * Thin binding over the core rule so a component never has to reach for
 * `relations.duplicates` itself — and so "the relation has not loaded yet"
 * (undefined) is a case this module owns rather than one each call site
 * remembers.
 */
export function markDuplicateExcludeIds(
  issueId: string,
  relations: IssueDuplicates | undefined,
): string[] {
  return duplicateTargetExclusions(issueId, relations);
}
