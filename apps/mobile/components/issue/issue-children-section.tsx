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
 */
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import type { Issue } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { IssueRow } from "./issue-row";
import { useTranslation } from "@/lib/i18n/react";
import { groupSubIssuesByStage } from "@/lib/sub-issue-grouping";
import { issueChildProgressOptions } from "@/data/queries/issues";
import { useWorkspaceStore } from "@/data/workspace-store";

interface Props {
  /** The parent issue's id — target of the "add sub-issue" sheet. */
  issueId: string;
  subIssues: Issue[] | undefined;
  wsSlug: string | undefined;
}

export function IssueChildrenSection({ issueId, subIssues, wsSlug }: Props) {
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  // Workspace-wide parent→(done/total) map — lets each sub-issue row show
  // its OWN nested progress ring without opening it. Deduped by TanStack
  // Query across every mounted section (web childIssueProgressOptions).
  // Fetched unconditionally (rules of hooks) though only used when the
  // section renders rows.
  const { data: childProgress } = useQuery(issueChildProgressOptions(wsId));

  // No sub-issues (empty / loading / error) → hide the section entirely
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
              onPress={() => {
                if (wsSlug) router.push(`/${wsSlug}/issue/${child.id}`);
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}