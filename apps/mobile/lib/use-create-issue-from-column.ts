/**
 * "New issue pre-filled from a board column" — the phone's equivalent of
 * web's `onCreateIssue(group.createData)` (packages/views/issues/
 * components/board-column.tsx:226-246).
 *
 * Order matters: the draft is reset, THEN seeded, THEN the route is pushed.
 * `new-issue.tsx` resets the draft on mount, so seeding a store that was not
 * already reset would be indistinguishable from seeding a stale one — the
 * mount reset is idempotent on the values we just wrote.
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
      const store = useNewIssueDraftStore.getState();
      store.reset();
      if (defaults) store.seedFromColumn(defaults);
      router.push(`/${wsSlug}/new-issue`);
    },
    [wsSlug],
  );
}
