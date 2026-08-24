/**
 * Agent activity — mobile port of web `activity-tab.tsx`
 * (packages/views/agents/components/tabs/activity-tab.tsx, MYS-710). Three
 * sections rendered inside the agent detail scroll surface:
 *
 *  - Now: the workspace task snapshot filtered to this agent's in-flight
 *    work (queued / dispatched / waiting_local_directory / running), ordered
 *    running → dispatched → waiting → queued, then created_at asc. Rows for
 *    queued / dispatched / running carry an inline cancel button.
 *  - Last 30 days: workspace 30d activity buckets summarised over the
 *    trailing 30-slot window (runs / success% / avg duration / failed) plus
 *    a bar sparkline of the day series.
 *  - Recent work: this agent's full task history filtered to terminal
 *    workflow runs (completed / failed / cancelled, chat excluded), newest
 *    first, paginated 10 + 20 per "Show more".
 *
 * Mobile differences vs web (documented so the divergence is deliberate):
 * there is no hover, so rows link into the linked issue by pressing the
 * whole row and cancel sits in a dedicated trailing button; trigger_summary
 * renders inline with a 2-line clamp instead of a hover tooltip; failure
 * reasons use the short status-label vocabulary rather than web's 21-value
 * failureReason taxonomy (web task-failure.ts) — the raw failure_reason text
 * is shown when the server persisted one.
 */
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  View,
} from "react-native";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import Svg, { Rect } from "react-native-svg";
import type { Agent, AgentTask } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { api } from "@/data/api";
import { agentTaskSnapshotOptions } from "@/data/queries/agent-task-snapshot";
import { agentTasksOptions } from "@/data/queries/agent-tasks";
import { useAgentActivityMap } from "@/data/queries/agent-activity";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { formatDateTime } from "@/lib/autopilot-format";
import { cn } from "@/lib/utils";
import {
  type ActivityBucket,
  CANCELLABLE_TASK_STATUSES,
  deriveAvgDurationLast30d,
  formatDurationMs,
  RECENT_INITIAL,
  RECENT_PAGE,
  sortActiveAgentTasks,
  sortRecentAgentTasks,
  summarizeActivityWindow,
} from "@/lib/agent-activity";

// Task status → text color, sharing `enum.taskStatus` vocabulary with the
// rest of the app.
const TASK_CLASS: Record<string, string> = {
  queued: "text-muted-foreground",
  dispatched: "text-brand",
  waiting_local_directory: "text-muted-foreground",
  running: "text-brand",
  completed: "text-muted-foreground",
  failed: "text-destructive",
  cancelled: "text-muted-foreground",
};

export function AgentActivitySection({
  agent,
  wsSlug,
  agents,
}: {
  agent: Agent;
  wsSlug: string | null;
  /** Optionally the pre-fetched workspace agent list — the activity map is
   *  built from it instead of issuing a second agents fetch. */
  agents?: readonly Agent[] | null;
}) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const queryClient = useQueryClient();

  const snapshot = useQuery(agentTaskSnapshotOptions(wsId));
  const agentTasks = useQuery(agentTasksOptions(wsId, agent.id));
  const { byAgent } = useAgentActivityMap(wsId, agents);
  const activity = byAgent.get(agent.id);

  // --- Now -----------------------------------------------------------------
  const activeTasks = useMemo(
    () => sortActiveAgentTasks(snapshot.data ?? [], agent.id),
    [snapshot.data, agent.id],
  );

  // --- Last 30 days --------------------------------------------------------
  const summary = useMemo(
    () => summarizeActivityWindow(activity, 30),
    [activity],
  );
  const avgDurationMs = useMemo(
    () => deriveAvgDurationLast30d(agentTasks.data ?? [], Date.now()),
    [agentTasks.data],
  );
  const successPct =
    summary.totalRuns > 0
      ? Math.round(((summary.totalRuns - summary.totalFailed) / summary.totalRuns) * 100)
      : 100;

  // --- Recent work ---------------------------------------------------------
  const recentAll = useMemo(
    () => sortRecentAgentTasks(agentTasks.data ?? [], agent.id),
    [agentTasks.data, agent.id],
  );
  const recentLoading = agentTasks.isLoading;
  const [recentLimit, setRecentLimit] = useState(RECENT_INITIAL);
  const recentTasks = recentAll.slice(0, recentLimit);
  const hasMoreRecent = recentAll.length > recentTasks.length;

  const cancelTask = useMutation({
    mutationFn: (taskId: string) => api.cancelTaskById(taskId),
    onError: (err) =>
      Alert.alert(
        t("agents.activity.cancelFailedToast"),
        err instanceof Error && err.message ? err.message : undefined,
      ),
    onSettled: () => {
      // The realtime layer also refreshes these on the task:cancelled event;
      // explicit invalidation here covers the no-WS path.
      queryClient.invalidateQueries({ queryKey: ["agent-task-snapshot", wsId] });
      queryClient.invalidateQueries({ queryKey: ["agent-tasks", wsId] });
      queryClient.invalidateQueries({ queryKey: ["agent-activity", wsId] });
    },
  });

  const recentSubtitle = recentLoading
    ? ""
    : recentAll.length === 0
      ? t("agents.activity.subtitleNoRecent")
      : hasMoreRecent
        ? t("agents.activity.subtitleRecentProgress", {
            shown: recentTasks.length,
            total: recentAll.length,
          })
        : t("agents.activity.subtitleRecentLatest", { count: recentTasks.length });

  return (
    <>
      {/* Now */}
      <SectionHeader
        title={t("agents.activity.sectionNow")}
        subtitle={
          activeTasks.length === 0
            ? t("agents.activity.subtitleNoActive")
            : t("agents.activity.subtitleActive", { count: activeTasks.length })
        }
      />
      {activeTasks.length === 0 ? (
        <Text className="px-4 text-sm text-muted-foreground">
          {t("agents.activity.emptyNow")}
        </Text>
      ) : (
        <View>
          {activeTasks.map((task) => (
            <ActivityTaskRow
              key={task.id}
              task={task}
              wsSlug={wsSlug}
              theme={theme}
              cancelling={cancelTask.isPending}
              onCancel={(taskId) => cancelTask.mutate(taskId)}
            />
          ))}
        </View>
      )}

      {/* Last 30 days */}
      <SectionHeader
        title={t("agents.activity.sectionLast30d")}
        subtitle={t("agents.activity.subtitlePerformance")}
      />
      {summary.totalRuns === 0 ? (
        <Text className="px-4 text-sm text-muted-foreground">
          {t("agents.activity.empty30d")}
        </Text>
      ) : (
        <View className="px-4 flex-row items-end justify-between gap-5">
          <View className="flex-1 min-w-0 gap-1">
            <View className="flex-row items-baseline gap-1.5">
              <Text className="text-2xl font-semibold text-foreground tabular-nums">
                {summary.totalRuns}
              </Text>
              <Text className="text-xs text-muted-foreground">
                {t("agents.activity.runs")}
              </Text>
            </View>
            <Text className="text-xs text-muted-foreground leading-5">
              {t("agents.activity.successPct", { percent: successPct })}
              {avgDurationMs > 0 ? (
                <>
                  {"   ·   "}
                  {t("agents.activity.avgDuration", {
                    value: formatDurationMs(avgDurationMs),
                  })}
                </>
              ) : null}
              {summary.totalFailed > 0 ? (
                <>
                  {"   ·   "}
                  <Text className="text-destructive">
                    {t("agents.activity.failedCount", {
                      count: summary.totalFailed,
                    })}
                  </Text>
                </>
              ) : null}
            </Text>
          </View>
          <ActivitySparkline
            buckets={summary.buckets}
            brand={theme.brand}
            destructive={theme.destructive}
          />
        </View>
      )}

      {/* Recent work */}
      <SectionHeader title={t("agents.activity.sectionRecent")} subtitle={recentSubtitle} />
      {recentLoading ? (
        <View className="px-4 py-3">
          <ActivityIndicator size="small" color={theme.mutedForeground} />
        </View>
      ) : recentTasks.length === 0 ? (
        <Text className="px-4 text-sm text-muted-foreground">
          {t("agents.activity.emptyRecent")}
        </Text>
      ) : (
        <>
          <View>
            {recentTasks.map((task, i) => (
              <View key={task.id}>
                {i > 0 ? <View className="h-px bg-border ml-4" /> : null}
                <ActivityTaskRow
                  task={task}
                  wsSlug={wsSlug}
                  theme={theme}
                  mode="recent"
                />
              </View>
            ))}
          </View>
          {hasMoreRecent ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("agents.activity.showMore")}
              onPress={() => setRecentLimit((n) => n + RECENT_PAGE)}
              className="px-4 py-3 active:opacity-70"
            >
              <Text className="text-sm font-medium text-brand">
                {t("agents.activity.showMore")}
              </Text>
            </Pressable>
          ) : null}
        </>
      )}
    </>
  );
}

function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <View className="px-4 pt-5 pb-2">
      <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
        {title}
      </Text>
      {subtitle ? (
        <Text className="mt-0.5 text-xs text-muted-foreground/80">{subtitle}</Text>
      ) : null}
    </View>
  );
}

function ActivityTaskRow({
  task,
  wsSlug,
  theme,
  mode = "active",
  cancelling = false,
  onCancel,
}: {
  task: AgentTask;
  wsSlug: string | null;
  theme: (typeof THEME)["light"];
  mode?: "active" | "recent";
  cancelling?: boolean;
  onCancel?: (taskId: string) => void;
}) {
  const { t } = useTranslation();

  const hasIssue = Boolean(task.issue_id);
  const cancellable = Boolean(
    mode === "active" && onCancel && CANCELLABLE_TASK_STATUSES.has(task.status),
  );
  const statusLabel = t(`enum.taskStatus.${task.status}`);
  const statusClass = TASK_CLASS[task.status] ?? "text-muted-foreground";

  // Row title — trigger summary, else a source label by origin. Chat rows
  // never reach this component (filtered out upstream) so the chat branch is
  // defensive.
  const title = task.trigger_summary?.trim()
    ? task.trigger_summary.trim()
    : hasIssue
      ? t("agents.activity.issueShort", { prefix: task.issue_id.slice(0, 8) })
      : task.autopilot_run_id
        ? t("agents.activity.sourceAutopilot")
        : task.chat_session_id
          ? t("agents.activity.sourceChat")
          : t("agents.activity.sourceUntracked");

  // Time line: active rows read as started/dispatched/queued; recent rows
  // show completion plus the run duration when both bounds exist.
  let timeText: string;
  if (mode === "active") {
    const prefix =
      task.status === "running" && task.started_at
        ? "agents.activity.startedPrefix"
        : task.status === "dispatched" && task.dispatched_at
          ? "agents.activity.dispatchedPrefix"
          : "agents.activity.queuedPrefix";
    timeText = t(prefix, { when: formatDateTime(timeOf(task)) });
  } else {
    timeText = formatDateTime(task.completed_at || task.created_at);
  }

  let durationText: string | null = null;
  if (mode === "recent" && task.started_at && task.completed_at) {
    const dur =
      new Date(task.completed_at).getTime() - new Date(task.started_at).getTime();
    if (dur > 0) durationText = formatDurationMs(dur);
  }

  // Short failure note — the raw persisted reason (mobile keeps the coarse
  // vocabulary; web's 21-value taxonomy isn't ported, see file header).
  const failureReason =
    mode === "recent" &&
    task.status === "failed" &&
    task.failure_reason
      ? task.failure_reason
      : null;

  const content = (
    <View className="flex-row items-center gap-3 px-4 py-2.5">
      <View
        className={cn(
          "size-2 rounded-full shrink-0",
          CANCELLABLE_TASK_STATUSES.has(task.status)
            ? "bg-brand"
            : task.status === "failed"
              ? "bg-destructive"
              : "bg-muted",
        )}
      />
      <View className="flex-1 min-w-0 gap-0.5">
        <View className="flex-row items-center gap-1.5">
          <Text className={cn("text-xs font-medium", statusClass)}>
            {statusLabel}
          </Text>
          {durationText ? (
            <Text className="text-[11px] text-muted-foreground/70 tabular-nums">
              {durationText}
            </Text>
          ) : null}
        </View>
        <Text className="text-sm text-foreground" numberOfLines={2}>
          {title}
        </Text>
        {failureReason ? (
          <Text className="text-xs text-destructive" numberOfLines={1}>
            {failureReason}
          </Text>
        ) : null}
        <Text className="text-[11px] text-muted-foreground/70 tabular-nums">
          {timeText}
        </Text>
      </View>
      {cancellable && !cancelling ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("agents.activity.cancelTask")}
          onPress={() => onCancel?.(task.id)}
          hitSlop={8}
          className="active:opacity-60"
        >
          <Ionicons
            name="close-circle-outline"
            size={18}
            color={theme.mutedForeground}
          />
        </Pressable>
      ) : cancelling ? (
        <ActivityIndicator size="small" color={theme.mutedForeground} />
      ) : null}
      {hasIssue ? (
        <Ionicons name="open-outline" size={16} color={theme.mutedForeground} />
      ) : null}
    </View>
  );

  if (hasIssue && wsSlug) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("a11y.openIssue")}
        onPress={() => router.push(`/${wsSlug}/issue/${task.issue_id}`)}
        className="active:bg-secondary"
      >
        {content}
      </Pressable>
    );
  }
  return content;
}

function timeOf(task: AgentTask): string {
  return task.started_at || task.dispatched_at || task.created_at;
}

/** 30-day bar sparkline of completed/total runs — failed days tinted. */
function ActivitySparkline({
  buckets,
  brand,
  destructive,
  width = 120,
  height = 34,
}: {
  buckets: ActivityBucket[];
  brand: string;
  destructive: string;
  width?: number;
  height?: number;
}) {
  const max = Math.max(
    1,
    ...buckets.map((b) => b.total),
  );
  const barWidth = Math.max(1, width / Math.max(1, buckets.length) - 1);
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {buckets.map((b, i) => {
        const h = Math.max(1, (b.total / max) * (height - 2));
        return (
          <Rect
            key={i}
            x={i * (width / Math.max(1, buckets.length))}
            y={height - h}
            width={barWidth}
            height={h}
            rx={1}
            fill={b.failed > 0 ? destructive : brand}
          />
        );
      })}
    </Svg>
  );
}