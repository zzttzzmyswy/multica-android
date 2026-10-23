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
import { actorNameText } from "@/components/ui/actor-name";
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
import { useRunWakeup } from "@/data/queries/run-wakeup";
import { useTimeAgo } from "@/lib/time-ago";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { summarizeTaskUsage } from "@/lib/task-usage";
import { useCustomPricingStore } from "@/lib/custom-pricing-store";
import { canRerunRun } from "@/lib/run-retry";
import {
  runDurationLabel,
  runReasonLabel,
  runUsageParts,
} from "@/lib/run-row-meta";
import { runTriggerLabel, wakeupRunLabel } from "@/lib/run-trigger-label";
import { isCancelledOutcome, runOutcomeLabel } from "@/lib/task-outcome";
import { useWakeupText } from "@/lib/use-wakeup-text";

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
  const { resolveActorName } = useActorLookup();
  const agentName = actorNameText(resolveActorName("agent", task.agent_id));
  const { t } = useTranslation();
  // `catalogs` is gated on this being a wakeup run: only those build the
  // "Wakeup · <condition>" sentence, and a condition can name a label or a
  // property. An ordinary run never reaches that branch, so arming the two
  // workspace-catalog reads for it would be two query observers per row for
  // data the row cannot draw — on an issue with 1,800 runs that is the
  // difference between one observer and 3,600. The `select` on the rule read
  // below is gated the same way (`enabled` inside `useRunWakeup`).
  const text = useWakeupText(!!task.wakeup_id);
  const timeAgo = useTimeAgo();
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const isActive = ACTIVE_STATUSES.includes(task.status);
  // A wakeup run's stored summary is the rule's INSTRUCTION, so quoting it
  // would describe what the agent was told, not why it ran. The rule — when
  // the issue still has it — names the condition instead; when it does not,
  // the label stays the complete "Triggered by wakeup" (web's
  // `wakeup-source-chip.tsx:58-66` does the same, and for the same reason: a
  // template with an empty condition reads as a rendering fault).
  const rule = useRunWakeup(issueId, task.wakeup_id);
  const fallbackSummaryText = runTriggerLabel(task, t);
  const summary = task.wakeup_id
    ? wakeupRunLabel(text, rule, fallbackSummaryText)
    : fallbackSummaryText;
  // Past tasks use completed_at when present (server fills it for terminal
  // statuses); active tasks fall back to created_at so the user sees how
  // long it's been waiting.
  const timestamp = task.completed_at || task.created_at;
  // `pricings` is a dependency, not a read: `summarizeTaskUsage` prices through
  // the custom-rate store imperatively, so without the subscription a rate
  // saved on the runtime page never reaches this row (web
  // `execution-log-section.tsx:247` subscribes for exactly this reason, and
  // `lib/custom-pricing-wiring.test.ts` pins the shape).
  const pricings = useCustomPricingStore((s) => s.pricings);
  const usage = useMemo(
    () => runUsageParts(summarizeTaskUsage(task.usage)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `pricings` re-prices; it is read imperatively by `estimateCost`
    [task.usage, pricings],
  );
  const reason = runReasonLabel(task, t);
  // Web's rule, and its reason: a run that stopped for a stated reason shows
  // the reason, and only an unexplained one shows how long it took
  // (`execution-log-section.tsx:685-692`). Mobile's StatusBadge already prints
  // "Failed · <reason>", so the reason slot here stays empty and the duration
  // is what the second line adds. Saying both would put the same sentence on
  // the row twice.
  const duration = reason ? null : runDurationLabel(task);

  const info = (
    <View className="flex-row items-start gap-3 py-2">
      <ActorAvatar type="agent" id={task.agent_id} size={28} showPresence />
      <View className="flex-1 gap-1">
        <Text
          className="text-body text-foreground"
          numberOfLines={2}
        >
          {/* The agent's name is asserted only once the AGENT directory has
           *  answered — `resolveActorName` keys readiness on the actor type, so
           *  a slow or failed member list cannot blank it. Run rows never draw a
           *  member, which is why this is the surface the per-type flag was
           *  built for (MYS-2219).
           *
           *  No mark in the name's place here, unlike the standalone cells: this
           *  name sits inline at the head of a sentence, and a load mark inside
           *  a <Text> is a View inside a Text — not a shape RN renders
           *  predictably. Withholding the name AND its separator is the
           *  sentence-surface answer (`components/inbox/detail-label.tsx` makes
           *  the same call); the avatar to the left is already an empty disc
           *  until the directory answers, so the row still reads as loading. */}
          {agentName ? (
            <>
              <Text className="font-medium">{agentName}</Text>
              <Text className="text-muted-foreground"> · {summary}</Text>
            </>
          ) : (
            <Text className="text-muted-foreground">{summary}</Text>
          )}
        </Text>
        {/* The facts line. Web puts these on one row beside the status mark
            because a desktop has hover to carry the exact values; a phone has
            no hover, so they are drawn as visible small text:
            status · duration · tokens · model · cost · when. Each slot hides
            itself when it has nothing to state rather than printing a zero. */}
        <View className="flex-row flex-wrap items-center gap-x-2 gap-y-0.5">
          <StatusBadge task={task} />
          {duration ? (
            <MetaText>{duration}</MetaText>
          ) : null}
          <MetaText>{usage ? usage.tokens : "—"}</MetaText>
          {usage?.model ? <MetaText>{usage.model}</MetaText> : null}
          <MetaText>{usage ? usage.cost : "—"}</MetaText>
          <MetaText>{timestamp ? timeAgo(timestamp) : ""}</MetaText>
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
 * One fact on the row's second line: caption-sized, muted, tabular. The
 * `tabular-nums` matters because durations, token counts and costs stack
 * vertically down the list — proportional digits make the column wobble as it
 * scrolls.
 */
function MetaText({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <Text className="text-caption text-muted-foreground tabular-nums">
      {children}
    </Text>
  );
}

function StatusBadge({ task }: { task: AgentTask }) {
  const { t } = useTranslation();
  // A failed row whose recorded reason is a cancellation ("cancelled" /
  // "user_cancelled" / "manual") was *stopped*, not broken. Printing
  // "Failed · Cancelled by the system" states both halves of a contradiction,
  // so those rows take the cancellation label and its calmer tone instead —
  // web's `isCancelledOutcome` rule (`task-failure.ts`, applied in
  // `inline-comment-run.tsx:85-88`). `cancelled` showed up 13 times in one
  // live sample of this deployment's task-runs, every one of them on a
  // status-`failed` row.
  if (isCancelledOutcome(task)) {
    // One label says how the run ended; null means nothing was recorded, so
    // the plain "Cancelled" status stands in.
    return (
      <Text className="text-caption text-muted-foreground">
        {runOutcomeLabel(task, t) ?? t("enum.taskStatus.cancelled")}
      </Text>
    );
  }
  const label = t(`enum.taskStatus.${task.status}`);
  const cls = STATUS_CLASS[task.status] ?? "text-muted-foreground";
  // For failed tasks, surface the failure_reason inline so users don't have
  // to drill in. Missing / empty / unrecognised stays as just "Failed".
  const reason = runReasonLabel(task, t);
  if (reason) {
    return (
      <Text className={`text-caption ${cls}`}>
        {label} · {reason}
      </Text>
    );
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

const STATUS_CLASS: Record<AgentTask["status"], string> = {
  queued: "text-muted-foreground",
  // A retry parked until its backoff expires. Same "not running yet" weight as
  // queued but warmer, so the row does not read as a second queued entry —
  // web's execution log gives it `text-warning` for the same reason. Rows in
  // this state are excluded from both the active and the past section (see
  // ACTIVE_STATUSES above and runs.tsx's past filter), so this entry is here
  // for exhaustiveness: without it the type stops compiling the moment core
  // names the status, and at runtime the lookup would silently fall through to
  // the muted default.
  deferred: "text-warning",
  dispatched: "text-brand",
  waiting_local_directory: "text-muted-foreground",
  running: "text-brand",
  completed: "text-muted-foreground",
  failed: "text-destructive",
  cancelled: "text-muted-foreground",
};
