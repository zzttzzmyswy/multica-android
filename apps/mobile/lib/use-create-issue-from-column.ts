/**
 * "New issue pre-filled from a board column" — the phone's equivalent of
 * web's `onCreateIssue(group.createData)` (packages/views/issues/
 * components/board-column.tsx:226-246).
 *
 * Seed only; do NOT reset. An earlier version called `store.reset()` first,
 * because `new-issue.tsx` wiped the draft on mount and seeding a store that
 * had not been reset was indistinguishable from seeding a stale one. Now that
 * the draft is persisted and restored (web parity, `multica_issue_draft`),
 * a reset here would throw away the very draft the user is coming back to —
 * and web does no such thing: its dialog initializes from the draft and lets
 * the column's `createData` override the fields it names. `seedFromColumn`
 * touches only the fields the column determines, so the rest of the draft
 * survives exactly as web lets it.
 *
 * Lives here (not in board-view) because only the surfaces know their own
 * route prefix and whether they offer creation at all; the board just hands
 * back the column it was tapped on.
 */
import { useCallback } from "react";
import { router } from "expo-router";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useNewIssueDraftStore } from "@/data/stores/new-issue-draft-store";
import { columnCreateDefaults, type IssueGroupSection } from "@/lib/filter-issues";

export function useCreateIssueFromColumn(): (
  section: IssueGroupSection,
) => void {
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);

  return useCallback(
    (section: IssueGroupSection) => {
      if (!wsSlug) return;
      const defaults = columnCreateDefaults(section);
      if (defaults) useNewIssueDraftStore.getState().seedFromColumn(defaults);
      router.push(`/${wsSlug}/new-issue`);
    },
    [wsSlug],
  );
}
