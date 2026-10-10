/**
 * Wakeups sheet (MYS-2023) — opened from the issue detail header badge
 * (`IssueWakeupHeaderBadge`). Presented as a formSheet by the parent Stack,
 * the same shape the runs sheet uses.
 *
 * Why a sheet rather than scrolling the header section into view: the badge
 * lives in the Stack header and is reachable from anywhere in the issue
 * (including from a comment far down the timeline). A push is one route and
 * works from every scroll position; scrolling to an inline section would need
 * the screen to hold a ref to the list and the section to report its offset,
 * and would still leave the badge inert when the section is off-screen.
 *
 * The body is the SAME `WakeupsSection` the issue header renders — it fetches
 * its own data and draws its own collapse header, so the two surfaces cannot
 * disagree about what the issue is waiting on.
 */
import { ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { WakeupsSection } from "@/components/issue/wakeups-section";
import { issueDetailOptions } from "@/data/queries/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";

export default function IssueWakeupsRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  // Already cached — the sheet is pushed from the issue detail Stack, so this
  // is not a new request in practice. It supplies the identifier for the
  // subtitle and the closed flag, which decides whether the section offers
  // the "cannot be enabled while completed" hint.
  const { data: issue } = useQuery(issueDetailOptions(wsId, id));

  return (
    <View className="flex-1">
      <View className="px-4 pt-4 pb-3">
        <Text className="text-title-sm font-semibold text-foreground">
          {t("wakeups.title")}
        </Text>
        {issue ? (
          <Text className="text-caption text-muted-foreground">
            {issue.identifier}
          </Text>
        ) : null}
      </View>
      <ScrollView showsVerticalScrollIndicator={false}>
        <WakeupsSection
          issueId={id}
          closed={issue?.status === "done" || issue?.status === "cancelled"}
          // Same seed as the issue header's section: the issue's agent
          // assignee, so a rule created from either surface starts on the
          // agent the issue actually runs.
          defaultAgentId={
            issue?.assignee_type === "agent"
              ? (issue.assignee_id ?? undefined)
              : undefined
          }
        />
        <View className="h-8" />
      </ScrollView>
    </View>
  );
}
