/**
 * Status picker route for an existing issue — presented as a formSheet
 * (UISheetPresentationController) by the parent Stack.
 *
 * Self-contained: reads the issue from the TanStack Query detail cache,
 * calls `useUpdateIssue` directly on selection, then `router.back()`s. No
 * onChange callback to a parent.
 *
 * If the cache is cold (rare — the user reaches this screen by tapping
 * a chip on the issue-detail page that already populated it), the picker
 * still renders against the current value of `todo` and the optimistic
 * mutation patches the cache when the user picks.
 */
import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { StatusPickerBody } from "@/components/issue/pickers/status-picker-body";
import { issueDetailOptions } from "@/data/queries/issues";
import { useUpdateIssue } from "@/data/mutations/issues";
import { useWorkspaceStore } from "@/data/workspace-store";

export default function IssueStatusPickerRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: issue } = useQuery(issueDetailOptions(wsId, id));
  const updateIssue = useUpdateIssue(id);

  return (
    <StatusPickerBody
      value={issue?.status ?? "todo"}
      // The issue's OWN project decides which statuses exist (MUL-7420). The
      // three-valued contract matters here: a cached issue with no project
      // yields `null`, which narrows to the Default workflow — the server's own
      // rule for a project-less issue — and must not become `undefined` ("this
      // surface spans projects"), which would offer the whole catalog and
      // restore the defect. Left `undefined` only while the issue itself is
      // unknown, where there is nothing truthful to narrow by.
      projectId={issue ? issue.project_id : undefined}
      onChange={(next) => {
        updateIssue.mutate({ status: next });
        router.back();
      }}
    />
  );
}
