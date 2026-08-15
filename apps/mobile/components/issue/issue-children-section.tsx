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
 */
import { View } from "react-native";
import { router } from "expo-router";
import type { Issue } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { IssueRow } from "./issue-row";
import { useTranslation } from "@/lib/i18n/react";
import { groupSubIssuesByStage } from "@/lib/sub-issue-grouping";

interface Props {
  subIssues: Issue[] | undefined;
  wsSlug: string | undefined;
}

export function IssueChildrenSection({ subIssues, wsSlug }: Props) {
  const { t } = useTranslation();

  // No sub-issues (empty / loading / error) → hide the section entirely
  // (matches web, which only mounts the SubIssues region on >0 data).
  if (!subIssues || subIssues.length === 0) return null;

  const groups = groupSubIssuesByStage(subIssues);

  return (
    <View className="border-t border-border">
      <View className="px-4 py-2">
        <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          {t("timeline.subtasks")}
        </Text>
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