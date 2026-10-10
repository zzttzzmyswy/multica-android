/**
 * Single row inside the agent-runs formSheet route
 * (`app/(app)/[workspace]/issue/[id]/runs.tsx`). Same component for active
 * and past tasks.
 *
 * Past tasks (completed / failed / cancelled) are collapsible: tapping the
 * row expands an inline `<RunLog>` panel loaded from `GET /api/tasks/:id/messages`
 * (agent's text narration + tool_use / tool_result / thinking / error steps).
 *
 * Active tasks (queued / dispatched / running) are ALSO expandable now —
 * tapping the row opens the trace while it is still growing, backed by a
 * short poll interval (`RunLog live`) so progress shows up even if a WS
 * event is lost. The Cancel button sits outside the expandable area so the
 * two actions never conflict.
 *
 * Text narration renders as markdown; process steps reuse the shared
 * `ChatTimeline` fold. Empty logs surface `runs.noLogs` / `runs.noLogsYet`.
 */
import { useMemo, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { AgentTask } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { RunTranscriptDialog } from "@/components/agent/run-transcript-dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { RunLog } from "./run-log";
import { RerunButton } from "./rerun-button";
import { useCancelTask } from "@/data/mutations/issues";
import { useActorLookup } from "@/data/use-actor-name";
import { useTimeAgo } from "@/lib/time-ago";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { formatTokens } from "@/lib/usage-format";
import { summarizeTaskUsage } from "@/lib/task-usage";
import { canRerunRun } from "@/lib/run-retry";

interface Props {
  task: AgentTask;
  issueId: string;
}

const ACTIVE_STATUSES: readonly AgentTask["status"][] = [
  "queued",
  "dispatched",
  // Daemon-parked task on a busy local_directory — still active (waiting on
  // a path lock), not terminal. Matches web's active-task filter.
  "waiting_local_directory",
  "running",
];

export function RunRow({ task, issueId }: Props) {
  const { getName } = useActorLookup();
  const { t } = useTranslation();
  const timeAgo = useTimeAgo();
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const isActive = ACTIVE_STATUSES.includes(task.status);
  const summary = task.trigger_summary?.trim() || fallbackSummary(task, t);
  // Past tasks use completed_at when present (server fills it for terminal
  // statuses); active tasks fall back to created_at so the user sees how
  // long it's been waiting.
  const timestamp = task.completed_at || task.created_at;

  const info = (
    <View className="flex-row items-start gap-3 py-2">
      <ActorAvatar type="agent" id={task.agent_id} size={28} showPresence />
      <View className="flex-1 gap-1">
        <Text
          className="text-body text-foreground"
          numberOfLines={2}
        >
          <Text className="font-medium">{getName("agent", task.agent_id)}</Text>
          <Text className="text-muted-foreground"> · {summary}</Text>
        </Text>
        <View className="flex-row items-center gap-2">
          <StatusBadge task={task} />
          <UsageTokens task={task} />
          <Text className="text-caption text-muted-foreground">
            {timestamp ? timeAgo(timestamp) : ""}
          </Text>
        </View>
      </View>
      {transcriptOpen ? (
        <RunTranscriptDialog
          taskId={task.id}
          taskStatus={task.status}
          task={task}
          onClose={() => setTranscriptOpen(false)}
        />
      ) : null}
    </View>
  );

  // Active tasks expand into a live, polled trace (matching web's live
  // transcript affordance); the Cancel action sits beside — never inside —
  // the expandable area so tapping either one does exactly what it says.
  if (isActive) {
    return (
      <Collapsible>
        <View className="flex-row items-center">
          <CollapsibleTrigger asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("runs.expandLog")}
              className="flex-1 active:bg-secondary"
            >
              <View className="flex-row items-start gap-3 pr-1">
                {info}
                <Ionicons
                  name="chevron-down"
                  size={14}
                  className="text-muted-foreground"
                  style={{ marginTop: 14 }}
                />
              </View>
            </Pressable>
          </CollapsibleTrigger>
          <View className="flex-row items-center gap-1 pl-2 pr-1">
            <TranscriptButton onPress={() => setTranscriptOpen(true)} />
            <CancelButton taskId={task.id} issueId={issueId} />
          </View>
        </View>
        <CollapsibleContent>
          <RunLog taskId={task.id} live />
        </CollapsibleContent>
      </Collapsible>
    );
  }

  // Past (terminal) rows: retry for failed/cancelled — the rerun targets
  // this SPECIFIC row's agent via task.id (web execution-log-section.tsx:471),
  // so it sits beside the expandable trace like the active-row Cancel.
  return (
    <Collapsible>
      <View className="flex-row items-center">
        <CollapsibleTrigger asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("runs.expandLog")}
            className="flex-1 active:bg-secondary"
          >
            <View className="flex-row items-start pr-1">
              {info}
              <Ionicons
                name="chevron-forward"
                size={14}
                className="text-muted-foreground"
                style={{ marginTop: 14 }}
              />
            </View>
          </Pressable>
        </CollapsibleTrigger>
        <View className="flex-row items-center gap-1 pl-2 pr-1">
          <TranscriptButton onPress={() => setTranscriptOpen(true)} />
          {canRerunRun(task.status) ? (
            <RerunButton taskId={task.id} issueId={issueId} />
          ) : null}
        </View>
      </View>
      <CollapsibleContent>
        <RunLog taskId={task.id} />
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Compact per-run token usage, next to the status badge. No figure → an em
 * dash, never 0: a run that predates usage reporting was not free, we just
 * don't know (web execution-log-section.tsx renders the same pair).
 * Display-only this round — the per-run breakdown dialog is a later item.
 */
function UsageTokens({ task }: { task: AgentTask }) {
  const summary = useMemo(() => summarizeTaskUsage(task.usage), [task.usage]);
  return (
    <Text className="text-caption text-muted-foreground tabular-nums">
      {summary ? formatTokens(summary.tokens) : "—"}
    </Text>
  );
}

function StatusBadge({ task }: { task: AgentTask }) {
  const { t } = useTranslation();
  const label = t(`enum.taskStatus.${task.status}`);
  const cls = STATUS_CLASS[task.status] ?? "text-muted-foreground";
  // For failed tasks, surface the failure_reason inline so users don't have
  // to drill in. Missing / empty / unrecognised stays as just "Failed".
  if (task.status === "failed" && task.failure_reason) {
    const key = `failureReason.${task.failure_reason}`;
    const reasonLabel = t(key);
    if (reasonLabel !== key) {
      return (
        <Text className={`text-caption ${cls}`}>
          {label} · {reasonLabel}
        </Text>
      );
    }
  }
  return <Text className={`text-caption ${cls}`}>{label}</Text>;
}

/**
 * The run's transcript entry point, on every row.
 *
 * Web puts a `TranscriptButton` in each execution-log row's actions
 * (`execution-log-section.tsx:383` active, `:517` past) — outside the activity
 * card that is the ONLY place the transcript is opened from. Mobile had no
 * such entry point at all: a run's trace was reachable only by expanding the
 * row, which shows the same messages but none of the transcript's per-run
 * facts (the usage chip, the run-details panel). Those facts are hydrated on
 * exactly the endpoint this row reads (`GET /api/issues/:id/task-runs`), so
 * without this button the whole surface would have been unreachable.
 */
function TranscriptButton({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("runs.transcript.open")}
      hitSlop={8}
      className="rounded-md p-1.5 active:opacity-70"
    >
      <Ionicons name="document-text-outline" size={16} color={theme.mutedForeground} />
    </Pressable>
  );
}

function CancelButton({
  taskId,
  issueId,
}: {
  taskId: string;
  issueId: string;
}) {
  const mutation = useCancelTask(issueId);
  const { t } = useTranslation();

  const onPress = () => {
    Alert.alert(
      t("runs.cancelTaskTitle"),
      t("runs.cancelTaskMessage"),
      [
        { text: t("runs.keepRunning"), style: "cancel" },
        {
          text: t("runs.cancelTask"),
          style: "destructive",
          onPress: () => mutation.mutate(taskId),
        },
      ],
    );
  };

  return (
    <Pressable
      onPress={onPress}
      disabled={mutation.isPending}
      className="px-3 py-1.5 rounded-md bg-secondary active:opacity-70"
    >
      <Text className="text-caption font-medium text-foreground">{t("runs.cancel")}</Text>
    </Pressable>
  );
}

function fallbackSummary(task: AgentTask, t: (id: string) => string): string {
  switch (task.kind) {
    case "comment":
      return t("runs.kind.comment");
    case "autopilot":
      return t("runs.kind.autopilot");
    case "chat":
      return t("runs.kind.chat");
    case "quick_create":
      return t("runs.kind.quickCreate");
    case "direct":
    default:
      return t("runs.kind.task");
  }
}

const STATUS_CLASS: Record<AgentTask["status"], string> = {
  queued: "text-muted-foreground",
  dispatched: "text-brand",
  waiting_local_directory: "text-muted-foreground",
  running: "text-brand",
  completed: "text-muted-foreground",
  failed: "text-destructive",
  cancelled: "text-muted-foreground",
};
