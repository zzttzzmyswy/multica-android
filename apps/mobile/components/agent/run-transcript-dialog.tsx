/**
 * Execution-transcript modal for a single agent task — the mobile port of
 * web's transcript entry (`TranscriptButton` → `AgentTranscriptDialog`,
 * `packages/views/common/task-transcript/`). Reads the task's message stream
 * through the same `taskMessagesOptions` query the Runs sheet uses, so
 * loading / error / empty and live-polling states behave exactly like the
 * issue Runs sheet, then adds web's reading controls: a type filter whose chips
 * are derived from the entries actually present, a sort-direction toggle, and a
 * per-entry copy action.
 *
 * `live` mirrors the row's running state (`isLive={isRunning}` on web): while
 * the task is running the log polls so the trace keeps growing on screen.
 */
import { useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { AgentTask } from "@multica/core/types";
import { prepareTaskMessages } from "@multica/core/task-transcript";
import { providerDisplayName, runtimeDisplayName } from "@multica/core/runtimes";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { AttributionBadge } from "@/components/agent/attribution-badge";
import { TranscriptEntryRow } from "@/components/agent/transcript-entry";
import { RunDetailsPanel } from "@/components/agent/run-details-panel";
import { taskMessagesOptions } from "@/data/queries/chat";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { useActorLookup } from "@/data/use-actor-name";
import { useWorkspaceStore } from "@/data/workspace-store";
import { attributionShouldRender } from "@/lib/task-attribution";
import { formatDateTime } from "@/lib/autopilot-format";
import { formatTokens } from "@/lib/usage-format";
import { formatUsd } from "@/lib/task-usage";
import { useCustomPricingStore } from "@/lib/custom-pricing-store";
import {
  buildRunDetailRows,
  buildUsageDetailRows,
  commentCoverageCount,
  hasRunDetails,
  transcriptTriggerLabelKey,
  transcriptUsageSummary,
} from "@/lib/run-transcript-details";
import { liveLogPollMs } from "@/lib/task-log-live";
import {
  deriveTranscriptFilterOptions,
  filterTranscriptEntries,
  resolveActiveFilterKeys,
  sortTranscriptEntries,
  type TranscriptSortDirection,
} from "@/lib/task-transcript";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

export function RunTranscriptDialog({
  taskId,
  taskStatus,
  task,
  onClose,
}: {
  taskId: string;
  taskStatus: AgentTask["status"];
  /**
   * The task object, when the caller already holds it. Optional because the
   * autopilot runs list only knows the run's `task_id` and the server exposes
   * no single-task GET a caller could hydrate from; those callers keep the
   * title-only header. Callers that do have the task (the activity row) pass
   * it, and the header then carries web's identity line — the agent and the
   * run's attribution.
   */
  task?: AgentTask;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const { getName } = useActorLookup();
  const live = taskStatus === "running";
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  // Web resolves the run's runtime through `api.listRuntimes()` on open
  // (agent-transcript-dialog.tsx:448-454). Mobile reads the already-cached
  // list instead — same source, no extra request fired from a modal, which
  // matters on cellular. The row is conditional either way, so a cache miss
  // costs the panel its runtime / provider / mode lines and nothing else.
  const { data: runtimes = [] } = useQuery({
    ...runtimeListOptions(wsId),
    // Only the panel needs this, and the panel only exists for a task the
    // caller passed in.
    enabled: !!task && !!wsId,
  });

  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [sortDirection, setSortDirection] = useState<TranscriptSortDirection>("oldest_first");
  const [runDetailsOpen, setRunDetailsOpen] = useState(false);

  const { data = [], isLoading, isError, refetch } = useQuery({
    ...taskMessagesOptions(taskId),
    refetchInterval: liveLogPollMs(live),
  });

  // Web's transcript reads `buildTimeline(msgs)`; the payload-shaped
  // equivalent merges the daemon's flush-split `thinking` / `text` fragments
  // and masks secrets, so a run shows the same entry count and the same
  // masked text as web.
  const entries = useMemo(() => prepareTaskMessages(data), [data]);

  // Chips come from the entries present, so a run never offers a facet it has
  // no events for (web derives `filterOptions` the same way).
  const filterOptions = useMemo(() => deriveTranscriptFilterOptions(entries), [entries]);
  // A selected key the current transcript lacks is a no-op, not an empty list
  // (web resolves its persisted selection against the derived options).
  const activeKeys = useMemo(
    () => resolveActiveFilterKeys(selectedKeys, filterOptions),
    [selectedKeys, filterOptions],
  );
  const filteredEntries = useMemo(
    () => filterTranscriptEntries(entries, activeKeys),
    [entries, activeKeys],
  );
  const displayEntries = useMemo(
    () => sortTranscriptEntries(filteredEntries, sortDirection),
    [filteredEntries, sortDirection],
  );

  const toggleFilterKey = (key: string) => {
    setSelectedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const sortLabel =
    sortDirection === "oldest_first"
      ? t("runs.transcript.sortOldest")
      : t("runs.transcript.sortNewest");

  // ── Header facts (web agent-transcript-dialog.tsx:610-661) ──────────────
  // "Why does this run exist", one word, and the comment-coverage figure that
  // flags a merged run. Both need the task, so a caller that only had an id
  // keeps the title-only header.
  const triggerLabel = task ? t(transcriptTriggerLabelKey(task)) : null;
  const coverageCount = task ? commentCoverageCount(task) : null;

  // This run's own spend. The header chip and the panel's usage block share
  // this one summary, so the two can never disagree. Only the issue
  // execution-log endpoint hydrates `usage`; on runs opened from an agent's
  // activity tab both the chip and the block are simply absent — never a
  // zeroed figure, which would claim the run was free
  // (packages/core/types/agent.ts:390-406).
  //
  // `pricings` is a dependency, not a read: `summarizeTaskUsage` prices
  // through the custom-rate store imperatively, so without the subscription a
  // rate saved elsewhere never reaches this figure (web agent-transcript-dialog
  // subscribes for exactly this reason).
  const pricings = useCustomPricingStore((s) => s.pricings);
  const usage = useMemo(
    () => transcriptUsageSummary(task?.usage),
    [task?.usage, pricings],
  );

  // The runtime behind this run, resolved from the cached list.
  const runtime = useMemo(
    () => runtimes.find((r) => r.id === task?.runtime_id),
    [runtimes, task?.runtime_id],
  );

  // ── The ⓘ sheet's contents (web :744-830) ───────────────────────────────
  // Built even while closed: the row list doubles as web's `hasRunDetails`
  // gate, so there is one definition of "anything to show" rather than a
  // second predicate that could disagree with the body.
  const detailRows = useMemo(
    () =>
      task
        ? buildRunDetailRows({
            task,
            runtimeName: runtime ? runtimeDisplayName(runtime) : null,
            providerLabel: runtime?.provider
              ? transcriptProviderLabel(runtime.provider)
              : null,
            runtimeMode: runtime?.runtime_mode ?? null,
            formatTime: formatDateTime,
          })
        : [],
    [task, runtime],
  );
  const usageRows = useMemo(
    () => (usage ? buildUsageDetailRows(usage, formatTokens, formatUsd) : null),
    [usage],
  );
  const showRunDetails = hasRunDetails(detailRows, usageRows);

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View
        className="flex-1 bg-background"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <View className="border-b border-border px-4 py-3 gap-1">
          <View className="flex-row items-center gap-3">
            <View className="size-8 rounded-lg bg-secondary items-center justify-center">
              <Ionicons
                name="document-text-outline"
                size={16}
                color={theme.mutedForeground}
              />
            </View>
            <Text className="flex-1 text-base font-semibold text-foreground">
              {t("agents.activity.transcriptTitle")}
            </Text>
            {/* What this run cost, in the header of the run being read, so
                "why was this one expensive" is answerable without leaving the
                transcript (web renders this chip in the same spot). Renders
                only on a real figure — `summarizeTaskUsage` returns null for
                both `undefined` and `[]`, and a chip reading "0 · $0.00" would
                claim the run was free. */}
            {usage ? (
              <View
                accessible
                accessibilityLabel={t("runs.transcript.usageChip")}
                className="shrink-0 flex-row items-center gap-1 rounded-full border border-border px-2 py-0.5"
              >
                <Ionicons name="cash-outline" size={11} color={theme.mutedForeground} />
                <Text className="text-micro font-medium text-foreground tabular-nums">
                  {formatTokens(usage.tokens)}
                </Text>
                <Text className="text-micro text-muted-foreground">·</Text>
                <Text className="text-micro text-muted-foreground tabular-nums">
                  {formatUsd(usage.cost)}
                </Text>
              </View>
            ) : null}
            {/* Tier-2 diagnostics. The ⓘ exists only when there is something
                behind it (web's `hasRunDetails`), so a bare task never opens an
                empty sheet. */}
            {showRunDetails ? (
              <Pressable
                onPress={() => setRunDetailsOpen(true)}
                accessibilityRole="button"
                accessibilityLabel={t("runs.transcript.runInfo")}
                hitSlop={8}
                className="shrink-0 active:opacity-70"
              >
                <Ionicons
                  name="information-circle-outline"
                  size={18}
                  color={theme.mutedForeground}
                />
              </Pressable>
            ) : null}
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t("a11y.close")}
              hitSlop={8}
            >
              <Ionicons name="close" size={20} color={theme.mutedForeground} />
            </Pressable>
          </View>
          {/* Identity line, web's transcript-header structure
              (agent-transcript-dialog.tsx:673-709): the agent that ran this is
              the one foreground entity, and the run's provenance reads as a
              separate muted unit beside it. The attribution carries NO avatar
              — two same-size faces would read as two agents (web's `hideAvatar`
              rationale). Absent when the caller only had a task id. */}
          {task ? (
            <View className="flex-row items-center gap-x-1.5 pl-11">
              <ActorAvatar type="agent" id={task.agent_id} size={16} />
              <Text
                numberOfLines={1}
                className="shrink text-xs font-medium text-foreground"
              >
                {getName("agent", task.agent_id)}
              </Text>
              {attributionShouldRender(task.attribution) ? (
                <>
                  <Text className="shrink-0 text-muted-foreground/70">{" · "}</Text>
                  <AttributionBadge
                    attribution={task.attribution}
                    variant="inline"
                  />
                </>
              ) : null}
              {/* "Why does this run exist", one word, set apart as its own
                  muted unit — web's tier-1 header puts it beside the
                  provenance for the same reason. The separator only appears
                  when something preceded it, so a bare attribution-less run
                  never opens with a dangling dot. */}
              {triggerLabel ? (
                <>
                  {attributionShouldRender(task.attribution) ? (
                    <Text className="shrink-0 text-muted-foreground/70">{" · "}</Text>
                  ) : null}
                  <Text
                    numberOfLines={1}
                    className="shrink text-xs text-muted-foreground"
                  >
                    {triggerLabel}
                  </Text>
                </>
              ) : null}
              {/* The merged-run flag. Silent for the ordinary single-comment
                  run, which is why the count is gated upstream rather than
                  formatted to "Includes 1 comment" on every row. */}
              {coverageCount !== null ? (
                <Text className="shrink-0 text-micro text-muted-foreground">
                  {t("runs.transcript.includedComments", { count: coverageCount })}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>

        {filterOptions.length > 0 ? (
          <View className="border-b border-border flex-row items-center gap-2 py-2">
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="flex-1"
              contentContainerClassName="gap-1.5 items-center px-4"
              accessibilityLabel={t("runs.transcript.filterLabel")}
            >
              <FilterChip
                label={t("runs.transcript.filterAll")}
                active={activeKeys.length === 0}
                onPress={() => setSelectedKeys([])}
              />
              {filterOptions.map((option) => (
                <FilterChip
                  key={option.key}
                  label={option.label}
                  active={activeKeys.includes(option.key)}
                  onPress={() => toggleFilterKey(option.key)}
                />
              ))}
            </ScrollView>
            {entries.length > 1 ? (
              <Pressable
                onPress={() =>
                  setSortDirection((prev) =>
                    prev === "oldest_first" ? "newest_first" : "oldest_first",
                  )
                }
                accessibilityRole="button"
                accessibilityLabel={sortLabel}
                className="mr-4 shrink-0 flex-row items-center gap-1 rounded-full border border-border px-2.5 py-1 active:opacity-70"
              >
                <Ionicons
                  name={sortDirection === "oldest_first" ? "arrow-down" : "arrow-up"}
                  size={12}
                  color={theme.mutedForeground}
                />
                <Text className="text-micro text-muted-foreground">{sortLabel}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {isLoading ? (
          <View className="py-6 items-center">
            <ActivityIndicator />
          </View>
        ) : isError && entries.length === 0 ? (
          <View className="px-4 py-3 items-start gap-2">
            <Text className="text-xs text-destructive">{t("runs.logLoadError")}</Text>
            <Pressable
              onPress={() => refetch()}
              accessibilityRole="button"
              className="px-2 py-1 rounded-md bg-secondary active:opacity-70"
            >
              <Text className="text-xs font-medium text-foreground">{t("issue.retry")}</Text>
            </Pressable>
          </View>
        ) : entries.length === 0 ? (
          <View className="px-4 py-3">
            <Text className="text-xs text-muted-foreground">{t("runs.noLogsYet")}</Text>
          </View>
        ) : displayEntries.length === 0 ? (
          <View className="px-4 py-6 items-center">
            <Text className="text-xs text-muted-foreground">
              {t("runs.transcript.filterEmpty")}
            </Text>
          </View>
        ) : (
          <ScrollView className="flex-1" contentContainerClassName="pb-4">
            {displayEntries.map((entry) => (
              <TranscriptEntryRow key={`${entry.task_id}-${entry.seq}`} entry={entry} />
            ))}
          </ScrollView>
        )}

        <RunDetailsPanel
          visible={runDetailsOpen}
          onClose={() => setRunDetailsOpen(false)}
          detailRows={detailRows}
          usageRows={usageRows}
        />
      </View>
    </Modal>
  );
}

/**
 * Provider slug → the name a reader recognises for the tool that ran this.
 *
 * Web keeps an override table here (`agent-transcript-dialog.tsx:1112-1122`)
 * because "claude" would otherwise render as "Claude" while a run's
 * diagnostics have always said "Claude Code", and `claude-code` is a legacy
 * provider value that title-cases to "Claude-code". Every other provider defers
 * to core's shared formatter so this row cannot drift from the runtime list.
 */
function transcriptProviderLabel(provider: string): string {
  return provider.toLowerCase() === "claude" || provider.toLowerCase() === "claude-code"
    ? "Claude Code"
    : providerDisplayName(provider);
}

/** One derived filter chip — an "all" chip or a `tool:<Name>` / type facet. */
function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      className={cn(
        "rounded-full border px-2.5 py-1",
        active ? "border-primary bg-primary/10" : "border-border bg-secondary/50",
      )}
    >
      <Text
        className={cn(
          "text-micro",
          active ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}
