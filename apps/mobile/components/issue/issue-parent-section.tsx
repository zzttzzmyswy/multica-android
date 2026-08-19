/**
 * Parent-issue block in the issue detail header (MYS-493).
 *
 * Shown only when the current issue has a parent (web parity —
 * `section_parent_issue` in packages/views/issues/components/issue-detail.tsx).
 * Renders the parent's status icon + identifier + title (truncated); tapping
 * navigates to the parent's detail. A trailing "unlink" action removes the
 * parent via `updateIssue(id, { parent_issue_id: null, stage: null })` —
 * mirrors web's `actions.removeParent()` (which also clears `stage` in the
 * same write; use-issue-actions.ts:203-214). Removal is direct like the web
 * action (reversible via "Set parent"), so no confirm sheet.
 *
 * When the parent is still loading, the section hides itself entirely —
 * same "no flash of incomplete content" rule the children section follows.
 */
import { Alert, Pressable, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { Issue } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { IconButton } from "@/components/ui/icon-button";
import { StatusIcon } from "@/components/ui/status-icon";
import { issueDetailOptions } from "@/data/queries/issues";
import { useUpdateIssueRelations } from "@/data/mutations/issues";
import { useIssueStatuses } from "@/data/queries/issue-statuses";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";

interface Props {
  issue: Issue;
  wsSlug?: string;
}

export function IssueParentSection({ issue, wsSlug }: Props) {
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const updateRelations = useUpdateIssueRelations();
  const statusStore = useIssueStatuses();

  const parentId = issue.parent_issue_id;
  // `enabled` gates the fetch; `?? ""` keeps the query key stable before the
  // parent resolves (issueDetailOptions requires a non-null id).
  const { data: parent } = useQuery({
    ...issueDetailOptions(wsId, parentId ?? ""),
    enabled: !!wsId && !!parentId,
  });

  // No parent (or not loaded yet) → hide entirely.
  if (!parentId || !parent) return null;

  const statusEntry = statusStore.entryOf(parent.status);

  const onRemoveParent = () => {
    updateRelations.mutate(
      { id: issue.id, patch: { parent_issue_id: null, stage: null } },
      {
        onError: (err) =>
          Alert.alert(
            t("issueRelation.updateFailed"),
            err instanceof Error && err.message ? err.message : undefined,
          ),
      },
    );
  };

  return (
    <View className="border-t border-border px-4 py-2 gap-1">
      <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
        {t("issueRelation.parent")}
      </Text>
      <View className="flex-row items-center gap-1">
        {/* Tap target mirrors web's AppLink — status icon + identifier +
            truncated title, whole row navigates to the parent. */}
        <Pressable
          onPress={() => {
            if (wsSlug) router.push(`/${wsSlug}/issue/${parent.id}`);
          }}
          className="flex-1 flex-row items-center gap-2 py-1 min-w-0 active:opacity-70"
        >
          <StatusIcon
            status={parent.status}
            category={statusEntry?.category}
            color={
              statusEntry?.is_system
                ? undefined
                : (statusEntry?.color ?? undefined)
            }
            size={14}
          />
          <Text className="text-xs text-muted-foreground shrink-0">
            {parent.identifier}
          </Text>
          <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
            {parent.title}
          </Text>
        </Pressable>
        <IconButton
          name="unlink-outline"
          iconSize={18}
          onPress={onRemoveParent}
          accessibilityLabel={t("issueRelation.removeParentAction")}
        />
      </View>
    </View>
  );
}