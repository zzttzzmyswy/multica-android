/**
 * "Add sub-issue" picker route for an existing issue.
 *
 * Opens a searchable issue picker (web parity — modals/add-child-issue.tsx +
 * issue-picker-modal.tsx) and, on select, rewrites the SELECTED issue's
 * parent to this issue: `updateIssue(selected.id, { parent_issue_id: id })`.
 *
 * Excludes (web add-child-issue.tsx:35-39):
 *   - the issue itself (it cannot be its own child),
 *   - its current parent (would invert the tree),
 *   - its existing direct children (would create a cycle).
 *
 * The mutation targets the selected issue — not the current one — so it uses
 * `useUpdateIssueRelations` (any-issue relations write) instead of the
 * issue-scoped `useUpdateIssue(issueId)`.
 */
import { useLocalSearchParams, router } from "expo-router";
import { Alert } from "react-native";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Issue } from "@multica/core/types";
import { IssuePickerBody } from "@/components/issue/pickers/issue-picker-body";
import {
  issueDetailOptions,
  issueChildrenOptions,
} from "@/data/queries/issues";
import { useUpdateIssueRelations } from "@/data/mutations/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";

export default function IssueAddChildRoute() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const updateRelations = useUpdateIssueRelations();

  const { data: issue } = useQuery(issueDetailOptions(wsId, id));
  const { data: children = [] } = useQuery(issueChildrenOptions(wsId, id));

  const excludeIds = useMemo(() => {
    const ids = new Set<string>([id]);
    if (issue?.parent_issue_id) ids.add(issue.parent_issue_id);
    for (const child of children) ids.add(child.id);
    return [...ids];
  }, [id, issue?.parent_issue_id, children]);

  const onSelect = (selected: Issue) => {
    updateRelations.mutate(
      { id: selected.id, patch: { parent_issue_id: id } },
      {
        onError: (err) =>
          Alert.alert(
            t("issueRelation.addChildFailed"),
            err instanceof Error && err.message ? err.message : undefined,
          ),
      },
    );
    router.back();
  };

  return (
    <IssuePickerBody
      title={t("issueRelation.addChildTitle")}
      description={t("issueRelation.addChildDescription")}
      excludeIds={excludeIds}
      onSelect={onSelect}
    />
  );
}