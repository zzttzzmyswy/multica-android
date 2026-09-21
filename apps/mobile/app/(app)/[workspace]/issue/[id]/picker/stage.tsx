/**
 * Stage picker route for an existing sub-issue. See ./status.tsx for the
 * self-contained-route rationale.
 *
 * A stage orders an issue against its SIBLINGS, so the option list is capped
 * by what the parent's other children already use — fetched here through
 * `issueChildrenOptions(parentId)`, which the detail page's sub-issue section
 * already keeps warm. The route is only reachable from the attribute row of an
 * issue that HAS a parent (the row gates the chip on `parent_issue_id`), but
 * the guard is repeated here: a stale deep link into this sheet on a root
 * issue would otherwise write a stage nothing can display.
 */
import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { StagePickerBody } from "@/components/issue/pickers/stage-picker-body";
import { issueChildrenOptions, issueDetailOptions } from "@/data/queries/issues";
import { useUpdateIssue } from "@/data/mutations/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { maxSiblingStage } from "@/lib/issue-stage";

export default function IssueStagePickerRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: issue } = useQuery(issueDetailOptions(wsId, id));
  const parentId = issue?.parent_issue_id ?? null;
  const { data: siblings = [] } = useQuery({
    ...issueChildrenOptions(wsId, parentId ?? ""),
    enabled: !!parentId,
  });
  const updateIssue = useUpdateIssue(id);

  // The issue itself is one of the children; its own stage does not need to
  // raise the ceiling (stageOptions already covers the current value), but
  // including it costs nothing and keeps this a plain "max over the family".
  const maxStage = maxSiblingStage(siblings);

  return (
    <StagePickerBody
      value={issue?.stage ?? null}
      maxStage={maxStage}
      onChange={(next) => {
        if (!parentId) {
          router.back();
          return;
        }
        updateIssue.mutate({ stage: next });
        router.back();
      }}
    />
  );
}
