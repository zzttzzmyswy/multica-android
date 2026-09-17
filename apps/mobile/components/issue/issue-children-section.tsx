/**
 * Sub-tasks ("children") section in the issue detail header.
 *
 * Renders the parent issue's direct children as a list of tappable rows —
 * each row shows the child's status icon + identifier + title and navigates
 * to that child's issue detail. Children that carry a `stage` are grouped
 * under a stage header, ascending; unstaged children render last with no
 * header. Mirrors web's `groupSubIssuesByStage` ordering
 * (packages/views/issues/components/issue-detail.tsx:398) so the mobile and
 * web clients show the same sequence.
 *
 * When the parent has no sub-issues (empty/loading/error), the section
 * renders `null` entirely — no header row, no blank space, no "empty" copy.
 * That matches web (the SubIssues region only mounts when there is >0 data).
 *
 * The header carries an "add sub-issue" affordance (MYS-493) — pushes the
 * `issue/[id]/picker/child` sheet with the exclude set (self / current
 * parent / existing direct children) computed inside that route. When the
 * issue has NO children yet, the actions menu on the detail page is the
 * entry point (this section is hidden, same as web).
 *
 * Iter-130 adds web's inline editing (issue-detail.tsx:634-833): the status
 * icon, the due-date chip and the assignee avatar are each their own press
 * target that opens the matching formSheet picker against the CHILD issue,
 * and long-pressing a row enters multi-select, which raises the shared
 * `BatchActionBar` at the bottom of the detail screen.
 */
import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Issue } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { IssueRow } from "./issue-row";
import { useTranslation } from "@/lib/i18n/react";
import { groupSubIssuesByStage } from "@/lib/sub-issue-grouping";
import { openIssuePicker } from "@/lib/issue-picker-route";
import { issueChildProgressOptions } from "@/data/queries/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useIssueBatchSelectionStore } from "@/data/stores/issue-batch-selection-store";

interface Props {
  /** The parent issue's id — target of the "add sub-issue" sheet. */
  issueId: string;
  subIssues: Issue[] | undefined;
  wsSlug: string | undefined;
}

export function IssueChildrenSection({ issueId, subIssues, wsSlug }: Props) {
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const queryClient = useQueryClient();
  const selectionMode = useIssueBatchSelectionStore((s) => s.selectionMode);
  const selectedIds = useIssueBatchSelectionStore((s) => s.selectedIds);
  const enterSelection = useIssueBatchSelectionStore((s) => s.enterSelection);
  const toggleSelection = useIssueBatchSelectionStore((s) => s.toggle);

  // Workspace-wide parent→(done/total) map — lets each sub-issue row show
  // its OWN nested progress ring without opening it. Deduped by TanStack
  // Query across every mounted section (web childIssueProgressOptions).
  // Fetched unconditionally (rules of hooks) though only used when the
  // section renders rows.
  const { data: childProgress } = useQuery(issueChildProgressOptions(wsId));

  // The batch-selection store is a shared singleton (the issue LISTS also
  // select into it), so only surface checkboxes when the live selection
  // actually lands inside this section. A selection carried in from a list
  // screen would otherwise paint checkmarks on unrelated sub-issue rows.
  const sectionSelectionMode = useMemo(
    () =>
      selectionMode &&
      !!subIssues?.some((child) => selectedIds.has(child.id)),
    [selectionMode, subIssues, selectedIds],
  );

  // No sub-issues (empty / loading/error) → hide the section entirely
  // (matches web, which only mounts the SubIssues region on >0 data).
  if (!subIssues || subIssues.length === 0) return null;

  const groups = groupSubIssuesByStage(subIssues);

  return (
    <View className="border-t border-border">
      <View className="flex-row items-center justify-between pr-2 pl-4 py-2">
        <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          {t("timeline.subtasks")}
        </Text>
        <Pressable
          onPress={() => {
            if (wsSlug)
              router.push(
                `/${wsSlug}/issue/${issueId}/picker/child`,
              );
          }}
          hitSlop={6}
          className="flex-row items-center gap-0.5 px-1.5 py-0.5 rounded-md active:bg-secondary"
          accessibilityLabel={t("issueRelation.addChildTitle")}
        >
          <Ionicons name="add" size={14} color="#71717a" />
          <Text className="text-xs font-medium text-muted-foreground">
            {t("issueRelation.addChildTitle")}
          </Text>
        </Pressable>
      </View>
      {groups.map((group, gi) => (
        <View key={group.stage?.toString() ?? `unstaged-${gi}`}>
          {group.stage != null ? (
            <View className="px-4 pt-2 pb-1">
              <Text className="text-xs font-medium text-muted-foreground">
                {t("timeline.stage", { stage: group.stage })}
              </Text>
            </View>
          ) : null}
          {group.items.map((child) => (
            <IssueRow
              key={child.id}
              issue={child}
              showStatus
              childProgress={childProgress?.[child.id]}
              selectionMode={sectionSelectionMode}
              selected={selectedIds.has(child.id)}
              onPress={() => {
                if (sectionSelectionMode) {
                  toggleSelection(child.id);
                  return;
                }
                if (wsSlug) router.push(`/${wsSlug}/issue/${child.id}`);
              }}
              onLongPress={() => enterSelection(child.id)}
              onPressStatus={() =>
                openIssuePicker("status", child, wsSlug, wsId, queryClient)
              }
              onPressAssignee={() =>
                openIssuePicker("assignee", child, wsSlug, wsId, queryClient)
              }
              onPressDueDate={() =>
                openIssuePicker("due-date", child, wsSlug, wsId, queryClient)
              }
              dueDate={child.due_date}
            />
          ))}
        </View>
      ))}
    </View>
  );
}