/**
 * "Set parent issue" picker route for an existing issue.
 *
 * Opens a searchable issue picker (web parity — modals/set-parent-issue.tsx)
 * and, on select, rewrites THIS issue's parent to the selected issue:
 * `updateIssue(id, { parent_issue_id: selected.id })`.
 *
 * Excludes (web set-parent-issue.tsx:28):
 *   - the issue itself (it cannot be its own parent),
 *   - its existing direct children (would create a cycle).
 *
 * Removing an existing parent is the sibling action in the issue detail
 * actions menu (`issue/[id].tsx` → `issueRelation.removeParentAction`).
 */
import { useLocalSearchParams, router } from "expo-router";
import { Alert } from "react-native";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Issue } from "@multica/core/types";
import { IssuePickerBody } from "@/components/issue/pickers/issue-picker-body";
import { issueChildrenOptions } from "@/data/queries/issues";
import { useUpdateIssueRelations } from "@/data/mutations/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";

export default function IssueSetParentRoute() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const updateRelations = useUpdateIssueRelations();

  const { data: children = [] } = useQuery(issueChildrenOptions(wsId, id));

  const excludeIds = useMemo(() => {
    const ids = new Set<string>([id]);
    for (const child of children) ids.add(child.id);
    return [...ids];
  }, [id, children]);

  const onSelect = (selected: Issue) => {
    updateRelations.mutate(
      { id, patch: { parent_issue_id: selected.id } },
      {
        onError: (err) =>
          Alert.alert(
            t("issueRelation.setParentFailed"),
            err instanceof Error && err.message ? err.message : undefined,
          ),
      },
    );
    router.back();
  };

  return (
    <IssuePickerBody
      title={t("issueRelation.setParentTitle")}
      description={t("issueRelation.setParentDescription")}
      excludeIds={excludeIds}
      onSelect={onSelect}
    />
  );
}