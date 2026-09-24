/**
 * Compact "an agent is on this issue right now" badge for the dense issue
 * surfaces — list rows, board cards, inbox rows.
 *
 * Mobile port of web's `IssueAgentActivityIndicator`
 * (packages/views/issues/components/issue-agent-activity-indicator.tsx), which
 * renders in all three of those surfaces. Before this, mobile's only live
 * activity surface was the issue detail page's `AgentActivityRow`, so a list
 * of issues looked idle while agents were working them.
 *
 *   ≥1 running task        → avatar stack + pulsing dot + "Working"
 *   0 running, ≥1 queued   → half-opacity stack + muted "Queued"
 *   nothing                → null (no chrome, no placeholder)
 *
 * Deliberately non-interactive. Web hangs a hover card off this badge; a phone
 * has no hover, and nesting a press target inside the row's own Pressable
 * would shadow the row tap. The drill-down (task list, elapsed time) stays on
 * the detail page's `AgentActivityRow` — here the badge is a cue only.
 *
 * Data comes from the one workspace-wide `agentTaskSnapshot` query: the same
 * cache the "agents working now" filter reads and `use-presence-realtime`
 * invalidates on task lifecycle events. Adding the badge to a row therefore
 * costs no extra request and no extra polling. The `select` keeps the returned
 * slice referentially stable when this issue's tasks have not moved, so an
 * unrelated task changing does not re-render every row.
 */
import { useCallback } from "react";
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { AgentTask } from "@multica/core/types";
import {
  selectIssueTasks,
  summarizeIssueActivity,
} from "@multica/core/issues/surface/issue-activity";
import { Text } from "@/components/ui/text";
import { AvatarStack, type StackActor } from "@/components/ui/avatar-stack";
import { PulseDot } from "@/components/ui/pulse-dot";
import { agentTaskSnapshotOptions } from "@/data/queries/agent-task-snapshot";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { cn } from "@/lib/utils";

interface Props {
  /** Empty ids are not a query — see the inbox row, which guards `issue_id`
   *  because notification rows may carry none. */
  issueId: string;
  /**
   * Surface colour painted between the stacked avatars. Defaults to the page
   * background; board cards pass their own (`bg-card`).
   */
  ringClassName?: string;
}

export function IssueAgentActivityIndicator({
  issueId,
  ringClassName = "bg-background",
}: Props) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();

  const select = useCallback(
    (snapshot: AgentTask[]) =>
      summarizeIssueActivity(selectIssueTasks(snapshot, issueId)),
    [issueId],
  );
  const { data } = useQuery({ ...agentTaskSnapshotOptions(wsId), select });

  if (!data || data.agentIds.length === 0) return null;
  const isRunning = data.state === "running";

  return (
    <View className="shrink-0 flex-row items-center gap-1">
      <View style={isRunning ? undefined : { opacity: 0.5 }}>
        <AvatarStack
          actors={data.agentIds.map<StackActor>((id) => ({
            type: "agent",
            id,
          }))}
          max={3}
          size={16}
          ringClassName={ringClassName}
        />
      </View>
      {isRunning ? <PulseDot size={6} /> : null}
      <Text
        className={cn(
          "text-[10px]",
          isRunning ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {isRunning ? t("issue.working") : t("status.queued")}
      </Text>
    </View>
  );
}
