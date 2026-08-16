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
import { Alert, Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { AgentTask } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { RunLog } from "./run-log";
import { useCancelTask } from "@/data/mutations/issues";
import { useActorLookup } from "@/data/use-actor-name";
import { useTimeAgo } from "@/lib/time-ago";
import { useTranslation } from "@/lib/i18n/react";

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
          className="text-sm text-foreground"
          numberOfLines={2}
        >
          <Text className="font-medium">{getName("agent", task.agent_id)}</Text>
          <Text className="text-muted-foreground"> · {summary}</Text>
        </Text>
        <View className="flex-row items-center gap-2">
          <StatusBadge task={task} />
          <Text className="text-xs text-muted-foreground">
            {timestamp ? timeAgo(timestamp) : ""}
          </Text>
        </View>
      </View>
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
                  color="#71717a"
                  style={{ marginTop: 14 }}
                />
              </View>
            </Pressable>
          </CollapsibleTrigger>
          <View className="pl-2 pr-1">
            <CancelButton taskId={task.id} issueId={issueId} />
          </View>
        </View>
        <CollapsibleContent>
          <RunLog taskId={task.id} live />
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("runs.expandLog")}
          className="flex-row items-start active:bg-secondary"
        >
          {info}
          <Ionicons
            name="chevron-forward"
            size={14}
            color="#71717a"
            style={{ marginTop: 14 }}
          />
        </Pressable>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <RunLog taskId={task.id} />
      </CollapsibleContent>
    </Collapsible>
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
        <Text className={`text-xs ${cls}`}>
          {label} · {reasonLabel}
        </Text>
      );
    }
  }
  return <Text className={`text-xs ${cls}`}>{label}</Text>;
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
      <Text className="text-xs font-medium text-foreground">{t("runs.cancel")}</Text>
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
