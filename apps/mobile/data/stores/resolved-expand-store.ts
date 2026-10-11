/**
 * Which resolved threads are temporarily expanded, per issue.
 *
 * Port of web's `packages/core/issues/stores/resolved-expand-store.ts`. Only
 * expanded thread-root ids are stored — "folded to a bar" is the default, so an
 * absent entry means folded and an empty set is never written.
 *
 * Why this is a store and not the comment card's own `useState`, which is where
 * mobile kept it until now: web's own note says it lives in a store "so the
 * command palette's fold/unfold-all-comments commands can drive it from outside
 * the issue page". Mobile now has those same two commands in its search panel
 * (`lib/search-commands.ts`), and a resolved thread expanded on the phone is
 * folded behind `ResolvedThreadBar` by component state that no external caller
 * can reach — `unfold all comments` would silently skip every resolved thread.
 * Store-backing it is what makes the pair of commands mean the same thing on
 * both platforms.
 *
 * Deliberately NOT persisted (matches web, which cites Linear): a reload folds
 * every resolved thread back to its summary bar. Same lifetime as the
 * comment-collapse store's in-memory half; only that one gets a file.
 */
import { create } from "zustand";

interface ResolvedExpandState {
  /** `issueId` → expanded thread-root ids. */
  expandedByIssue: Record<string, ReadonlySet<string>>;
  setExpanded: (issueId: string, commentId: string, expand: boolean) => void;
  /** Expand every thread root in `commentIds` at once (unfold-all). */
  expandAll: (issueId: string, commentIds: readonly string[]) => void;
  /** Fold every expanded thread back to its bar (fold-all). */
  collapseAll: (issueId: string) => void;
}

/** Stable empty set — a selector returning a fresh `new Set()` per call would
 *  re-render forever through useSyncExternalStore (see apps/mobile/CLAUDE.md
 *  "Common Zustand footguns"). */
const EMPTY_EXPANDED: ReadonlySet<string> = new Set();

function withoutIssue(
  expandedByIssue: Record<string, ReadonlySet<string>>,
  issueId: string,
): Record<string, ReadonlySet<string>> {
  const { [issueId]: _, ...rest } = expandedByIssue;
  return rest;
}

export const useResolvedExpandStore = create<ResolvedExpandState>()((set) => ({
  expandedByIssue: {},

  // Web's early return on a no-op keeps the record identity stable, so
  // re-expanding an already-expanded thread re-renders nobody.
  setExpanded: (issueId, commentId, expand) =>
    set((s) => {
      const current = s.expandedByIssue[issueId] ?? EMPTY_EXPANDED;
      if (current.has(commentId) === expand) return s;
      const next = new Set(current);
      if (expand) next.add(commentId);
      else next.delete(commentId);
      if (next.size === 0) {
        return { expandedByIssue: withoutIssue(s.expandedByIssue, issueId) };
      }
      return { expandedByIssue: { ...s.expandedByIssue, [issueId]: next } };
    }),

  expandAll: (issueId, commentIds) =>
    set((s) => {
      if (commentIds.length === 0) return s;
      const next = new Set(s.expandedByIssue[issueId] ?? EMPTY_EXPANDED);
      for (const id of commentIds) next.add(id);
      return { expandedByIssue: { ...s.expandedByIssue, [issueId]: next } };
    }),

  collapseAll: (issueId) =>
    set((s) => {
      if (!(issueId in s.expandedByIssue)) return s;
      return { expandedByIssue: withoutIssue(s.expandedByIssue, issueId) };
    }),
}));

/**
 * One issue's expanded set, as a stable reference. Falls back to the shared
 * frozen empty set so an unrelated issue's write doesn't re-render this card.
 */
export function selectExpandedResolved(issueId: string | null) {
  return (s: ResolvedExpandState): ReadonlySet<string> =>
    issueId ? (s.expandedByIssue[issueId] ?? EMPTY_EXPANDED) : EMPTY_EXPANDED;
}
