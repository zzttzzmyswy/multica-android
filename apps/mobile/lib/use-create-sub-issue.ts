/**
 * "New sub-issue under this one" — the phone's equivalent of web's
 * `meta.createSubIssue(issue)` in the issue table's `InlineTitle`
 * (packages/views/issues/components/table-view.tsx:2103).
 *
 * Carried as route params rather than through `useNewIssueDraftStore`: the
 * parent is a property of the *navigation*, not a chip the user edits on the
 * form, so it belongs to this push rather than to the draft — and a draft
 * restored from disk must not be able to resurrect a parent the user is no
 * longer creating under.
 */
import { useCallback } from "react";
import { router } from "expo-router";
import type { Issue } from "@multica/core/types";
import { useWorkspaceStore } from "@/data/workspace-store";
import { subIssueRouteParams } from "@/lib/sub-issue-route";

export function useCreateSubIssue(): (parent: Issue) => void {
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);

  return useCallback(
    (parent: Issue) => {
      if (!wsSlug) return;
      router.push({
        pathname: "/[workspace]/new-issue",
        params: { workspace: wsSlug, ...subIssueRouteParams(parent) },
      });
    },
    [wsSlug],
  );
}
