/**
 * Header badge for an issue's wakeup rules (MYS-2023) — the phone counterpart
 * of web's `IssueWakeupHeaderChip`
 * (packages/views/issues/components/issue-wakeup-header-chip.tsx).
 *
 * Sits beside `AgentHeaderBadge` in the issue detail Stack header. Renders
 * null when the issue is waiting on nothing, so the common issue gains no
 * chrome.
 *
 * Why a header badge AND a section: the section scrolls away with the
 * timeline, and a rule waits for minutes to days. A reader who has scrolled
 * into the comments needs to see that the issue is still waiting on something
 * without scrolling back to the top — the same reasoning that put
 * AgentHeaderBadge here (see agent-header-badge.tsx).
 *
 * Tap pushes the `issue/[id]/wakeups` formSheet — the same one-route-per-
 * surface shape AgentHeaderBadge uses for runs. Pushing rather than scrolling
 * to the section: the sheet is reachable from anywhere in the issue, and the
 * section is only ever one screenful from the top.
 */
import { Pressable } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n/react";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useActorLookup } from "@/data/use-actor-name";
import { useStatusLabel } from "@/lib/status-options";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import {
  issueWakeupsOptions,
  issueSystemWakeupsOptions,
} from "@/data/queries/issue-wakeups";
import {
  primaryWakeup,
  wakeupHeadlineText,
  type WakeupTextDeps,
} from "@/lib/wakeup-presentation";

interface Props {
  issueId: string;
}

export function IssueWakeupHeaderBadge({ issueId }: Props) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const statusLabel = useStatusLabel();
  const { getName } = useActorLookup();
  const { data: rules = [] } = useQuery(issueWakeupsOptions(wsId, issueId));
  const { data: system = [] } = useQuery(
    issueSystemWakeupsOptions(wsId, issueId),
  );

  const primary = primaryWakeup(rules, system);
  if (!primary) return null;

  const text: WakeupTextDeps = {
    t,
    statusLabel,
    actorName: (type: string, id: string) => getName(type as "agent", id),
  };
  const label =
    primary.kind === "rule"
      ? wakeupHeadlineText(text, primary.rule)
      : primary.kind === "system"
        ? t("wakeups.wait.header", {
            agent: primary.rule.target?.name ?? "",
            what:
              primary.rule.staged && primary.rule.stage !== null
                ? t("wakeups.wait.childrenStage", {
                    stage: primary.rule.stage,
                  })
                : t("wakeups.wait.childrenAll"),
          })
        : t("wakeups.wait.paused");

  // `paused` reads in the warning tone: it is the one state that needs a
  // person, and it is the only thing the chip shows when nothing else waits.
  const paused = primary.kind === "paused";

  return (
    <Pressable
      onPress={() => {
        if (!wsSlug) return;
        router.push({
          pathname: "/[workspace]/issue/[id]/wakeups",
          params: { workspace: wsSlug, id: issueId },
        });
      }}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`${label}${primary.count > 1 ? ` +${primary.count - 1}` : ""} · ${t("wakeups.wait.open")}`}
      className="flex-row items-center gap-1 px-1.5 py-1 active:opacity-60"
    >
      <Ionicons
        name={paused ? "warning-outline" : "notifications-outline"}
        size={14}
        color={paused ? theme.warning : theme.mutedForeground}
      />
      {/* The count, not the sentence: a phone Stack header is ~44pt tall with
          two other buttons already in it, and the headline is a full clause.
          The full sentence is the accessibility label and the sheet's title. */}
      {primary.count > 1 ? (
        <Text className="text-xs tabular-nums text-muted-foreground">
          {primary.count}
        </Text>
      ) : null}
    </Pressable>
  );
}
