/**
 * Workspace usage screen (push screen reached from the More popover).
 * Mirrors web `packages/views/dashboard` — the Usage and Errors surfaces:
 *
 *  - KPI tiles: total tokens, tasks, agent count.
 *  - Trend tab: per-day token bars (pure RN Views, no chart dep) + a daily
 *    breakdown (input / output / cache / total) — same numbers as web's
 *    UsageTrendCard via aggregateDailyTokens / computeDailyTotals.
 *  - Leaderboard tab: per-agent tokens + task counts, tokens desc. Unknown
 *    agents fold into the same synthetic buckets web renders (deleted /
 *    restricted), never a raw UUID — bucketUnknownAgentRows (MUL-3776 parity:
 *    per-agent rows must reconcile with the KPI totals, so spend is folded,
 *    not dropped).
 *  - Errors tab (iteration 44): failure analysis mirroring web's dashboard
 *    Errors tab — 3 KPI tiles (failed tasks / rate / agents affected), a
 *    per-day failure bar chart, the 7-class failure mix with an error-code
 *    breakdown, and a Top Offenders list ranked by failures or rate with a
 *    TOP-8 collapse (errors-tab.tsx parity, including UNRESOLVED_AGENTS_ROW_ID
 *    folding so the list never shows a bare UUID).
 *
 * Layout divergence from web is deliberate and phone-sized: tabs replace the
 * web dashboard split, and a 7/30-day segmented control replaces the
 * full-width date-range picker — same queries, same aggregation, fewer pixels.
 */
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Stack } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Project } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { ProjectIcon } from "@/components/ui/project-icon";
import {
  dashboardAgentRunTimeOptions,
  dashboardFailuresByAgentOptions,
  dashboardFailuresDailyOptions,
  dashboardRunTimeDailyOptions,
  dashboardUsageByAgentOptions,
  dashboardUsageDailyOptions,
} from "@/data/queries/usage";
import { api } from "@/data/api";
import { projectListOptions } from "@/data/queries/projects";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  activeAgentCount,
  aggregateByAgent,
  aggregateDailyTokens,
  computeDailyTotals,
  DELETED_AGENTS_ROW_ID,
  formatTokens,
  isSyntheticAgentRow,
  RESTRICTED_AGENTS_ROW_ID,
  type UsageDailyAggregate,
} from "@/lib/usage-format";
import {
  aggregateDailyTasks,
  aggregateDailyTime,
  bucketAgentDashboardRows,
  formatDuration,
  mergeAgentDashboardRows,
  type AgentDashboardRow,
  type DailyTasksRow,
  type DailyTimeRow,
} from "@/lib/usage-time";
import {
  aggregateAgentFailures,
  aggregateDailyErrors,
  aggregateFailureClasses,
  aggregateFailureReasons,
  computeFailureTotals,
  failureClassColors,
  formatRate,
  hasRateSample,
  MIN_RATE_SAMPLE,
  OFFENDER_METRIC,
  sortAgentFailures,
  UNRESOLVED_AGENTS_ROW_ID,
  type AgentFailureRow,
  type DailyErrorsRow,
  type FailureClassRow,
  type FailureReasonRow,
  type FailureTotals,
  type OffenderSort,
} from "@/lib/usage-errors";
import { FAILURE_CLASSES, type FailureClass } from "@/lib/failure-class";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

type Range = 1 | 7 | 30 | 90 | 180;
type ViewMode = "trend" | "leaderboard" | "errors";
type UsageMetric = "tokens" | "time" | "tasks";

// Iteration 87: web TIME_RANGES parity (packages/views/dashboard/dashboard-shared).
// The 1d/7d/30d/90d/180d set mirrors the web dashboard's page-scoped
// TimeRangeFilter.
const RANGES: Range[] = [1, 7, 30, 90, 180];

const CHART_HEIGHT = 112;

// How many offenders the list shows before collapsing the tail behind a
// toggle (web TOP_OFFENDER_LIMIT parity).
const TOP_OFFENDER_LIMIT = 8;

export default function UsagePage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;

  const [range, setRange] = useState<Range>(30);
  const [mode, setMode] = useState<ViewMode>("trend");
  const [metric, setMetric] = useState<UsageMetric>("tokens");
  // Iteration 87 page-scoped project filter: null = whole workspace, mirroring
  // web's ALL_PROJECTS->null derivation (dashboard-page.tsx). A project id
  // that no longer resolves counts as no filter — same reading web applies.
  const [projectValue, setProjectValue] = useState<string | null>(null);
  const [rangeModalOpen, setRangeModalOpen] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);

  // Project list feeds the page-level project filter (iteration 87). Same
  // query as web's projectListOptions for the dashboard ProjectFilter.
  const projectsQuery = useQuery({
    ...projectListOptions(wsId),
    enabled: !!wsId,
  });
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  // A project id that no longer resolves (deleted, or stale from another
  // workspace) counts as no filter — the same reading web applies when it
  // derives the effective `projectId` for the queries.
  const effectiveProjectId = useMemo(() => {
    if (!projectValue) return null;
    return projects.some((p) => p.id === projectValue) ? projectValue : null;
  }, [projectValue, projects]);
  const selectedProject =
    projects.find((p) => p.id === effectiveProjectId) ?? null;

  const daily = useQuery(dashboardUsageDailyOptions(wsId, range, effectiveProjectId));
  const byAgent = useQuery(dashboardUsageByAgentOptions(wsId, range, effectiveProjectId));
  // Run-time / task-count rollups power the Time/Tasks metric toggle, the
  // Run time / Tasks KPI tiles and the leaderboard's run-time column
  // (iteration 45). Fetched up front like the token rollups — smaller than
  // the failure payloads, and the KPI row always shows them.
  const runTime = useQuery({
    ...dashboardAgentRunTimeOptions(wsId, range, effectiveProjectId),
    // These power the KPI row and the Time/Tasks trend; the Errors tab
    // shows neither, so skip the per-second refetch while it is open.
    enabled: !!wsId && mode !== "errors",
  });
  const runTimeDaily = useQuery({
    ...dashboardRunTimeDailyOptions(wsId, range, effectiveProjectId),
    enabled: !!wsId && mode !== "errors",
  });
  // include_archived so a retired agent keeps its name on the leaderboard
  // instead of collapsing into the deleted bucket (web parity).
  const agents = useQuery({
    queryKey: ["agents", wsId, "usage"] as const,
    queryFn: ({ signal }) => api.listAgents({ signal, includeArchived: true }),
    enabled: !!wsId,
  });

  // Failures rollups only fetched while the Errors tab is visible; switching
  // tabs back to it after a range change refetches via the days key.
  const failuresDaily = useQuery({
    ...dashboardFailuresDailyOptions(wsId, range, effectiveProjectId),
    enabled: !!wsId && mode === "errors",
  });
  const failuresByAgent = useQuery({
    ...dashboardFailuresByAgentOptions(wsId, range, effectiveProjectId),
    enabled: !!wsId && mode === "errors",
  });

  const errorsLoading = failuresDaily.isLoading || failuresByAgent.isLoading;
  const errorsError = failuresDaily.error ?? failuresByAgent.error;
  const isLoading =
    daily.isLoading ||
    byAgent.isLoading ||
    runTime.isLoading ||
    runTimeDaily.isLoading ||
    agents.isLoading ||
    (mode === "errors" && errorsLoading);
  const error =
    daily.error ??
    byAgent.error ??
    runTime.error ??
    runTimeDaily.error ??
    agents.error ??
    (mode === "errors" ? errorsError : null);

  const dailyRows = useMemo(
    () => aggregateDailyTokens(daily.data ?? []),
    [daily.data],
  );
  const totals = useMemo(
    () => computeDailyTotals(daily.data ?? []),
    [daily.data],
  );

  const dailyTime = useMemo(
    () => aggregateDailyTime(runTimeDaily.data ?? []),
    [runTimeDaily.data],
  );
  const dailyTasks = useMemo(
    () => aggregateDailyTasks(runTimeDaily.data ?? []),
    [runTimeDaily.data],
  );
  // Whole-window run-time / task totals for the KPI tiles, summed from the
  // per-agent run-time rollup (web parity: that rollup is the source of the
  // dashboard's Run time / Tasks tiles).
  const runTimeTotals = useMemo(() => {
    let totalSeconds = 0;
    let taskCount = 0;
    let failedCount = 0;
    for (const r of runTime.data ?? []) {
      totalSeconds += r.total_seconds;
      taskCount += r.task_count;
      failedCount += r.failed_count;
    }
    return { totalSeconds, taskCount, failedCount };
  }, [runTime.data]);

  // Leaderboard rows: token totals merged with the run-time rollup so
  // taskCount is the accurate distinct count and run time rides along.
  // Unknown agents fold into the deleted bucket (spend kept, time/tasks
  // dashed out — deleted agents never contributed to the run-time rollup).
  const agentRows = useMemo(() => {
    const known = agents.data ? new Set(agents.data.map((a) => a.id)) : null;
    return bucketAgentDashboardRows(
      mergeAgentDashboardRows(aggregateByAgent(byAgent.data ?? []), runTime.data ?? []),
      known,
    );
  }, [byAgent.data, runTime.data, agents.data]);

  const agentName = useMemo(() => {
    const byId = new Map((agents.data ?? []).map((a) => [a.id, a.name]));
    return (agentId: string): string => {
      if (agentId === RESTRICTED_AGENTS_ROW_ID) return t("usage.otherAgents");
      if (agentId === DELETED_AGENTS_ROW_ID) return t("usage.deletedAgents");
      return byId.get(agentId) ?? t("usage.unknownAgent");
    };
  }, [agents.data, t]);

  const errorTotals = useMemo(
    () => computeFailureTotals(failuresDaily.data ?? []),
    [failuresDaily.data],
  );
  const dailyErrors = useMemo(
    () => aggregateDailyErrors(failuresDaily.data ?? []),
    [failuresDaily.data],
  );
  const classRows = useMemo(
    () => aggregateFailureClasses(failuresDaily.data ?? []),
    [failuresDaily.data],
  );
  const reasonRows = useMemo(
    () => aggregateFailureReasons(failuresDaily.data ?? []),
    [failuresDaily.data],
  );
  const offenderRows = useMemo(
    () => aggregateAgentFailures(failuresByAgent.data ?? [], agents.data),
    [failuresByAgent.data, agents.data],
  );

  const agentCount = useMemo(
    () => activeAgentCount(agentRows),
    [agentRows],
  );

  const maxDaily = useMemo(
    () => dailyRows.reduce((m, d) => Math.max(m, d.total), 0),
    [dailyRows],
  );
  const maxTime = useMemo(
    () => dailyTime.reduce((m, d) => Math.max(m, d.totalSeconds), 0),
    [dailyTime],
  );
  const maxTasks = useMemo(
    () =>
      dailyTasks.reduce(
        (m, d) => Math.max(m, d.completed + d.failed + d.cancelled),
        0,
      ),
    [dailyTasks],
  );
  const maxAgent = useMemo(
    () => agentRows.reduce((m, r) => Math.max(m, r.tokens), 0),
    [agentRows],
  );

  const showEmpty =
    !isLoading &&
    !error &&
    mode !== "errors" &&
    dailyRows.length === 0 &&
    agentRows.length === 0;

  return (
    <>
      <Stack.Screen options={{ headerBackTitle: t("common.back") }} />
      <View className="flex-1 bg-background">
        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator />
          </View>
        ) : error ? (
          <View className="px-4 gap-3 pt-4">
            <Text className="text-sm text-destructive">
              {t("usage.loadError")}
              {error instanceof Error ? error.message : t("common.unknownError")}
            </Text>
            <Button
              variant="outline"
              onPress={() => {
                void daily.refetch();
                void byAgent.refetch();
                void runTime.refetch();
                void runTimeDaily.refetch();
                if (mode === "errors") {
                  void failuresDaily.refetch();
                  void failuresByAgent.refetch();
                }
              }}
            >
              <Text>{t("workspace.retry")}</Text>
            </Button>
          </View>
        ) : showEmpty ? (
          <View className="flex-1 items-center justify-center px-6 gap-1">
            <Ionicons name="bar-chart-outline" size={32} color={muted} />
            <Text className="text-sm text-muted-foreground text-center mt-2">
              {t("usage.emptyTitle")}
            </Text>
            <Text className="text-xs text-muted-foreground/70 text-center">
              {t("usage.emptyDescription")}
            </Text>
          </View>
        ) : (
          <ScrollView
            contentContainerClassName="pb-10"
            className="flex-1"
            refreshControl={
              <RefreshControl
                refreshing={
                  daily.isRefetching ||
                  byAgent.isRefetching ||
                  runTime.isRefetching ||
                  runTimeDaily.isRefetching
                }
                onRefresh={() => {
                  void daily.refetch();
                  void byAgent.refetch();
                  void runTime.refetch();
                  void runTimeDaily.refetch();
                  if (mode === "errors") {
                    void failuresDaily.refetch();
                    void failuresByAgent.refetch();
                  }
                }}
              />
            }
          >
            {/* Time range segmented control + page-level project filter
                (iteration 87) — web dashboard TimeRangeFilter / ProjectFilter
                parity, phone-sized. */}
            <View className="flex-row items-center justify-between gap-2 px-4 pt-3 pb-1">
              <View className="flex-row items-center gap-1">
                {RANGES.map((r) => {
                  const active = range === r;
                  return (
                    <Pressable
                      key={r}
                      accessibilityRole="button"
                      accessibilityLabel={t(`usage.range${r}`)}
                      onPress={() => setRange(r)}
                      className={cn(
                        "rounded-full px-2 py-1",
                        active ? "bg-foreground" : "bg-muted",
                      )}
                    >
                      <Text
                        className={cn(
                          "text-xs font-medium",
                          active ? "text-background" : "text-muted-foreground",
                        )}
                      >
                        {t(`usage.range${r}`)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("usage.projectFilterLabel")}
                onPress={() => setProjectModalOpen(true)}
                className="flex-row items-center gap-1 rounded-full border border-border px-2.5 py-1 max-w-[140px]"
              >
                <Ionicons
                  name={selectedProject ? "folder" : "folder-outline"}
                  size={13}
                  color={muted}
                />
                <Text
                  numberOfLines={1}
                  className={cn(
                    "text-xs font-medium flex-shrink",
                    selectedProject
                      ? "text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {selectedProject
                    ? selectedProject.title
                    : t("usage.projectAll")}
                </Text>
                <Ionicons name="chevron-down" size={12} color={muted} />
              </Pressable>
            </View>

            {/* KPI tiles — usage metrics; the Errors tab brings its own.
                Tasks / Run time source from the run-time rollup (accurate
                distinct counts), web parity. */}
            {mode !== "errors" ? (
              <View className="flex-row gap-3 px-4 py-3">
                <KpiCard
                  icon="flash"
                  label={t("usage.totalTokens")}
                  value={formatTokens(totals.total)}
                />
                <KpiCard
                  icon="time-outline"
                  label={t("usage.totalRunTime")}
                  value={formatDuration(
                    runTimeTotals.totalSeconds,
                    t("usage.lessThanMinute"),
                  )}
                  hint={t("usage.totalRunTimeHint", { tasks: runTimeTotals.taskCount })}
                />
                <KpiCard
                  icon="checkmark-circle-outline"
                  label={t("usage.totalTasks")}
                  value={String(runTimeTotals.taskCount)}
                  hint={t("usage.totalTasksHint", { failed: runTimeTotals.failedCount })}
                />
                <KpiCard
                  icon="people-outline"
                  label={t("usage.agents")}
                  value={String(agentCount)}
                />
              </View>
            ) : null}

            {/* View mode segmented control */}
            <View className="flex-row gap-2 px-4">
              <ModePill active={mode === "trend"} label="usage.trendTab" onPress={() => setMode("trend")} />
              <ModePill
                active={mode === "leaderboard"}
                label="usage.leaderboardTab"
                onPress={() => setMode("leaderboard")}
              />
              <ModePill
                active={mode === "errors"}
                label="usage.errorsTab"
                onPress={() => setMode("errors")}
              />
            </View>

            {mode === "trend" ? (
              <TrendSection
                metric={metric}
                onMetricChange={setMetric}
                dailyTokens={dailyRows}
                dailyTime={dailyTime}
                dailyTasks={dailyTasks}
                maxTokens={maxDaily}
                maxTime={maxTime}
                maxTasks={maxTasks}
                colorScheme={colorScheme}
              />
            ) : mode === "leaderboard" ? (
              <LeaderboardSection
                rows={agentRows}
                max={maxAgent}
                agentName={agentName}
                colorScheme={colorScheme}
              />
            ) : (
              <ErrorsSection
                days={range}
                totals={errorTotals}
                dailyErrors={dailyErrors}
                classRows={classRows}
                reasonRows={reasonRows}
                offenderRows={offenderRows}
                agentName={agentName}
                colorScheme={colorScheme}
              />
            )}
          </ScrollView>
        )}
        <RangePickerModal
          visible={rangeModalOpen}
          range={range}
          onPick={(r) => {
            setRange(r);
            setRangeModalOpen(false);
          }}
          onClose={() => setRangeModalOpen(false)}
        />
        <ProjectPickerModal
          visible={projectModalOpen}
          projects={projects}
          value={effectiveProjectId}
          onPick={(id) => {
            setProjectValue(id);
            setProjectModalOpen(false);
          }}
          onClose={() => setProjectModalOpen(false)}
        />
      </View>
    </>
  );
}

/** Time-range single-select — web dashboard TimeRangeFilter DropdownMenu, as
 *  a phone-sized Modal (iteration 87). */
function RangePickerModal({
  visible,
  range,
  onPick,
  onClose,
}: {
  visible: boolean;
  range: Range;
  onPick: (next: Range) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const primary = THEME[colorScheme].primary;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable className="flex-1 bg-black/40" onPress={onClose}>
        <View className="flex-1 items-center justify-center px-6">
          <Pressable onPress={() => {}} className="w-full max-w-sm">
            <View className="bg-popover rounded-2xl overflow-hidden">
              <View className="px-4 py-3 border-b border-border">
                <Text className="text-base font-semibold text-foreground">
                  {t("usage.periodLabel")}
                </Text>
              </View>
              <View className="py-1">
                {RANGES.map((r) => {
                  const active = range === r;
                  return (
                    <Pressable
                      key={r}
                      accessibilityRole="button"
                      onPress={() => onPick(r)}
                      className="flex-row items-center justify-between px-4 py-3 active:bg-secondary"
                    >
                      <Text className="text-sm text-foreground">
                        {t(`usage.range${r}`)}
                      </Text>
                      {active ? (
                        <Ionicons name="checkmark" size={18} color={primary} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

/** Page-level project filter — web dashboard ProjectFilter DropdownMenu, as a
 *  phone-sized Modal (iteration 87). "All projects" is the null filter, the
 *  same ALL_PROJECTS sentinel web derives to null. */
function ProjectPickerModal({
  visible,
  projects,
  value,
  onPick,
  onClose,
}: {
  visible: boolean;
  projects: Project[];
  value: string | null;
  onPick: (id: string | null) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const primary = THEME[colorScheme].primary;
  const muted = THEME[colorScheme].mutedForeground;
  const rows: ({ kind: "all" } | { kind: "project"; project: Project })[] = [
    { kind: "all" },
    ...[...projects]
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((p) => ({ kind: "project" as const, project: p })),
  ];
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable className="flex-1 bg-black/40" onPress={onClose}>
        <View className="flex-1 items-center justify-center px-6">
          <Pressable onPress={() => {}} className="w-full max-w-sm">
            <View className="bg-popover rounded-2xl overflow-hidden">
              <View className="px-4 py-3 border-b border-border">
                <Text className="text-base font-semibold text-foreground">
                  {t("usage.projectFilterLabel")}
                </Text>
              </View>
              <FlatList
                data={rows}
                className="max-h-96"
                keyboardShouldPersistTaps="handled"
                keyExtractor={(r) =>
                  r.kind === "all" ? "__all__" : `p:${r.project.id}`
                }
                renderItem={({ item }) => {
                  const selected =
                    item.kind === "all"
                      ? value === null
                      : value === item.project.id;
                  const label =
                    item.kind === "all" ? t("usage.projectAll") : item.project.title;
                  return (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() =>
                        onPick(item.kind === "all" ? null : item.project.id)
                      }
                      className="flex-row items-center justify-between px-4 py-3 active:bg-secondary"
                    >
                      <View className="flex-1 flex-row items-center gap-2 pr-2">
                        {item.kind === "all" ? (
                          <Ionicons
                            name="folder-open-outline"
                            size={16}
                            color={muted}
                          />
                        ) : (
                          <ProjectIcon icon={item.project.icon} size="sm" />
                        )}
                        <Text
                          numberOfLines={1}
                          className="flex-shrink text-sm text-foreground"
                        >
                          {label}
                        </Text>
                      </View>
                      {selected ? (
                        <Ionicons name="checkmark" size={18} color={primary} />
                      ) : null}
                    </Pressable>
                  );
                }}
              />
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

function ModePill({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      className={cn("rounded-full px-4 py-1.5", active ? "bg-foreground" : "bg-muted")}
    >
      <Text className={cn("text-xs font-medium", active ? "text-background" : "text-muted-foreground")}>
        {t(label)}
      </Text>
    </Pressable>
  );
}

function KpiCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  value: string;
  hint?: string;
}) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <View className="flex-1 rounded-xl border border-border bg-card px-3 py-2.5">
      <View className="flex-row items-center gap-1.5">
        <Ionicons name={icon} size={13} color={theme.mutedForeground} />
        <Text
          className="text-[11px] text-muted-foreground"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
        >
          {label}
        </Text>
      </View>
      <Text
        className="mt-1 text-lg font-semibold text-foreground"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {value}
      </Text>
      {hint ? (
        <Text className="mt-0.5 text-[10px] text-muted-foreground/70" numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const METRIC_ORDER: UsageMetric[] = ["tokens", "time", "tasks"];

const METRIC_LABEL: Record<UsageMetric, string> = {
  tokens: "usage.metricTokens",
  time: "usage.metricTime",
  tasks: "usage.metricTasks",
};

/**
 * Spend / run time / tasks over time: one x-axis, three metrics behind a
 * toggle so the reader can mentally overlay them (web UsageTrendCard parity;
 * cost is omitted — it needs a client-side model pricing table). Pure RN
 * Views, no chart dependency.
 */
function TrendSection({
  metric,
  onMetricChange,
  dailyTokens,
  dailyTime,
  dailyTasks,
  maxTokens,
  maxTime,
  maxTasks,
  colorScheme,
}: {
  metric: UsageMetric;
  onMetricChange: (m: UsageMetric) => void;
  dailyTokens: UsageDailyAggregate[];
  dailyTime: DailyTimeRow[];
  dailyTasks: DailyTasksRow[];
  maxTokens: number;
  maxTime: number;
  maxTasks: number;
  colorScheme: "light" | "dark";
}) {
  const { t } = useTranslation();
  const theme = THEME[colorScheme];
  const muted = theme.mutedForeground;
  const brand = theme.brand;

  const title =
    metric === "tokens"
      ? t("usage.dayTrendTitle")
      : metric === "time"
        ? t("usage.dayTrendTimeTitle")
        : t("usage.dayTrendTasksTitle");

  return (
    <View className="mt-3 px-4 gap-3">
      <View className="rounded-xl border border-border bg-card p-3">
        <View className="mb-3 flex-row flex-wrap items-center justify-between gap-2">
          <Text className="text-xs font-medium text-foreground">{title}</Text>
          <View className="flex-row items-center gap-1">
            {METRIC_ORDER.map((m) => (
              <MetricPill
                key={m}
                active={metric === m}
                label={t(METRIC_LABEL[m])}
                onPress={() => onMetricChange(m)}
              />
            ))}
          </View>
        </View>

        {metric === "tokens" ? (
          <TrendBars
            rows={dailyTokens.map((d) => ({ date: d.date, label: d.label, value: d.total }))}
            max={maxTokens}
            color={brand}
            noDataLabel={t("usage.noData")}
          />
        ) : metric === "time" ? (
          <TrendBars
            rows={dailyTime.map((d) => ({ date: d.date, label: d.label, value: d.totalSeconds }))}
            max={maxTime}
            color={brand}
            noDataLabel={t("usage.noData")}
          />
        ) : (
          <TasksStack rows={dailyTasks} max={maxTasks} theme={theme} noDataLabel={t("usage.noData")} />
        )}

        <Text className="mt-2 text-[9px] text-muted-foreground/70">
          {t("usage.metricCostNote")}
        </Text>
      </View>

      {/* Per-day detail rows for the active metric */}
      <View className="rounded-xl border border-border bg-card px-3">
        {metric === "tokens"
          ? dailyTokens.map((d, idx) => (
              <View
                key={d.date}
                className={cn(
                  "flex-row items-center gap-2 py-2.5",
                  idx > 0 && "border-t border-border/60",
                )}
              >
                <Text className="w-14 text-xs font-medium text-foreground">{d.label}</Text>
                <TokenCell label={t("usage.inputLabel")} value={d.input} muted={muted} />
                <TokenCell label={t("usage.outputLabel")} value={d.output} muted={muted} />
                <TokenCell
                  label={t("usage.cacheLabel")}
                  value={d.cacheRead + d.cacheWrite}
                  muted={muted}
                />
                <Text className="w-16 text-right text-xs font-semibold text-foreground">
                  {formatTokens(d.total)}
                </Text>
              </View>
            ))
          : metric === "time"
            ? dailyTime.map((d, idx) => {
                const tasksRow = dailyTasks.find((x) => x.date === d.date);
                const taskCount = tasksRow
                  ? tasksRow.completed + tasksRow.failed + tasksRow.cancelled
                  : 0;
                const failed = tasksRow?.failed ?? 0;
                return (
                  <View
                    key={d.date}
                    className={cn(
                      "flex-row items-center gap-2 py-2.5",
                      idx > 0 && "border-t border-border/60",
                    )}
                  >
                    <Text className="w-14 text-xs font-medium text-foreground">{d.label}</Text>
                    <StatCell
                      value={formatDuration(d.totalSeconds, t("usage.lessThanMinute"))}
                      sublabel={t("usage.timeLabel")}
                      muted={muted}
                    />
                    <StatCell value={String(taskCount)} sublabel={t("usage.totalTasks")} muted={muted} />
                    <StatCell value={String(failed)} sublabel={t("usage.failedLabel")} muted={muted} />
                  </View>
                );
              })
            : dailyTasks.map((d, idx) => (
                <View
                  key={d.date}
                  className={cn(
                    "flex-row items-center gap-2 py-2.5",
                    idx > 0 && "border-t border-border/60",
                  )}
                >
                  <Text className="w-14 text-xs font-medium text-foreground">{d.label}</Text>
                  <StatCell value={String(d.completed)} sublabel={t("usage.completedLabel")} muted={muted} />
                  <StatCell value={String(d.failed)} sublabel={t("usage.failedLabel")} muted={muted} />
                  <StatCell value={String(d.cancelled)} sublabel={t("usage.cancelledLabel")} muted={muted} />
                </View>
              ))}
      </View>
    </View>
  );
}

function MetricPill({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={cn("rounded-full px-2.5 py-1", active ? "bg-foreground" : "bg-muted")}
    >
      <Text
        className={cn(
          "text-[10px] font-medium",
          active ? "text-background" : "text-muted-foreground",
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Single-series bar row, shared by the tokens and run-time metrics. */
function TrendBars({
  rows,
  max,
  color,
  noDataLabel,
}: {
  rows: { date: string; label: string; value: number }[];
  max: number;
  color: string;
  noDataLabel: string;
}) {
  if (rows.length === 0) {
    return <Text className="text-xs text-muted-foreground">{noDataLabel}</Text>;
  }
  const labelEvery = rows.length > 8 ? 2 : 1;
  return (
    <View className="flex-row items-end gap-1.5" style={{ height: CHART_HEIGHT + 22 }}>
      {rows.map((d, i) => {
        const h = max > 0 ? Math.max((d.value / max) * CHART_HEIGHT, 2) : 2;
        return (
          <View key={d.date} className="flex-1 items-center gap-1">
            <View
              style={{
                height: h,
                borderTopLeftRadius: 4,
                borderTopRightRadius: 4,
                backgroundColor: color,
                opacity: d.value > 0 ? 0.85 : 0.15,
                width: "100%",
                maxWidth: 26,
              }}
            />
            {i % labelEvery === 0 ? (
              <Text className="text-[9px] text-muted-foreground" numberOfLines={1}>
                {d.label}
              </Text>
            ) : (
              <Text className="text-[9px] text-transparent" numberOfLines={1}>
                ·
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

/**
 * Task-outcome stacked bars: completed at the bottom (brand), cancelled in
 * the middle (muted — a manual stop is an outcome, not an error), failed on
 * top (destructive emphasis). Lets the reader see the day-over-day failure
 * trend without a separate chart (web DailyTasksChart parity).
 */
function TasksStack({
  rows,
  max,
  theme,
  noDataLabel,
}: {
  rows: DailyTasksRow[];
  max: number;
  theme: { brand: string; destructive: string; mutedForeground: string };
  noDataLabel: string;
}) {
  if (rows.length === 0) {
    return <Text className="text-xs text-muted-foreground">{noDataLabel}</Text>;
  }
  const labelEvery = rows.length > 8 ? 2 : 1;
  return (
    <View className="flex-row items-end gap-1.5" style={{ height: CHART_HEIGHT + 22 }}>
      {rows.map((d, i) => {
        const total = d.completed + d.failed + d.cancelled;
        const h = max > 0 ? Math.max((total / max) * CHART_HEIGHT, 2) : 2;
        return (
          <View key={d.date} className="flex-1 items-center gap-1">
            <View
              style={{
                height: h,
                width: "100%",
                maxWidth: 26,
                borderRadius: 4,
                overflow: "hidden",
                backgroundColor: theme.mutedForeground,
                opacity: total > 0 ? 0.9 : 0.15,
                flexDirection: "column-reverse",
              }}
            >
              {/* column-reverse: first child renders at the bottom. */}
              <View style={{ flex: d.completed, backgroundColor: theme.brand }} />
              <View style={{ flex: d.cancelled, backgroundColor: theme.mutedForeground }} />
              <View style={{ flex: d.failed, backgroundColor: theme.destructive }} />
            </View>
            {i % labelEvery === 0 ? (
              <Text className="text-[9px] text-muted-foreground" numberOfLines={1}>
                {d.label}
              </Text>
            ) : (
              <Text className="text-[9px] text-transparent" numberOfLines={1}>
                ·
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

/** Right-aligned value + sublabel cell for the per-day breakdown rows. */
function StatCell({
  value,
  sublabel,
  muted,
}: {
  value: string;
  sublabel: string;
  muted: string;
}) {
  return (
    <View className="flex-1">
      <Text className="text-right text-xs font-medium text-foreground" numberOfLines={1}>
        {value}
      </Text>
      <Text
        className="text-right text-[9px] text-muted-foreground"
        style={{ color: muted }}
        numberOfLines={1}
      >
        {sublabel}
      </Text>
    </View>
  );
}

function TokenCell({
  label,
  value,
  muted,
}: {
  label: string;
  value: number;
  muted: string;
}) {
  return (
    <View className="flex-1">
      <Text className="text-right text-xs font-medium text-foreground" numberOfLines={1}>
        {formatTokens(value)}
      </Text>
      <Text className="text-right text-[9px] text-muted-foreground" style={{ color: muted }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function LeaderboardSection({
  rows,
  max,
  agentName,
  colorScheme,
}: {
  rows: AgentDashboardRow[];
  max: number;
  agentName: (agentId: string) => string;
  colorScheme: "light" | "dark";
}) {
  const { t } = useTranslation();
  const brand = THEME[colorScheme].brand;
  const less = t("usage.lessThanMinute");

  if (rows.length === 0) {
    return (
      <View className="mt-6 items-center">
        <Text className="text-xs text-muted-foreground">{t("usage.noData")}</Text>
      </View>
    );
  }

  return (
    <View className="mt-3 px-4">
      <View className="rounded-xl border border-border bg-card px-3 py-1">
        {rows.map((r, idx) => {
          const synthetic = isSyntheticAgentRow(r.agentId);
          const deleted = r.agentId === DELETED_AGENTS_ROW_ID;
          const pct = max > 0 ? (r.tokens / max) * 1 : 0;
          return (
            <View
              key={r.agentId}
              className={cn(
                "flex-row items-center gap-2 py-2.5",
                idx > 0 && "border-t border-border/60",
              )}
            >
              <View className="w-5">
                {synthetic ? (
                  <Ionicons name="archive-outline" size={16} color={THEME[colorScheme].mutedForeground} />
                ) : (
                  <ActorAvatar type="agent" id={r.agentId} size={20} />
                )}
              </View>
              <View className="flex-1">
                <Text className="text-xs font-medium text-foreground" numberOfLines={1}>
                  {agentName(r.agentId)}
                </Text>
                <View className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <View
                    style={{
                      width: `${Math.max(pct * 100, r.tokens > 0 ? 4 : 0)}%`,
                      height: "100%",
                      borderRadius: 999,
                      backgroundColor: brand,
                      opacity: synthetic ? 0.45 : 0.8,
                    }}
                  />
                </View>
              </View>
              <Text className="w-16 text-right text-xs font-semibold text-foreground">
                {formatTokens(r.tokens)}
              </Text>
              <View className="w-16 items-end">
                {deleted ? (
                  <Text className="text-xs text-muted-foreground">—</Text>
                ) : (
                  <>
                    <Text className="text-xs text-muted-foreground">
                      {formatDuration(r.seconds, less)}
                    </Text>
                    <Text className="text-[9px] text-muted-foreground/70">{t("usage.timeLabel")}</Text>
                  </>
                )}
              </View>
              <View className="w-12 items-end">
                {deleted ? (
                  <Text className="text-xs text-muted-foreground">—</Text>
                ) : (
                  <>
                    <Text className="text-xs text-muted-foreground">{r.taskCount}</Text>
                    <Text className="text-[9px] text-muted-foreground/70">{t("usage.tasksShort")}</Text>
                  </>
                )}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Errors tab (iteration 44) — failure analysis mirroring web's dashboard
// Errors tab (packages/views/dashboard/components/errors-tab.tsx). Pure RN
// Views only; the 7-class colour ramp comes from failureClassColors().
// ---------------------------------------------------------------------------

const FAILURE_CLASS_KEY: Record<FailureClass, string> = {
  auth: "usage.errors.class.auth",
  rate_limit: "usage.errors.class.rateLimit",
  timeout: "usage.errors.class.timeout",
  provider: "usage.errors.class.provider",
  runtime: "usage.errors.class.runtime",
  agent: "usage.errors.class.agent",
  other: "usage.errors.class.other",
};

function ErrorsSection({
  days,
  totals,
  dailyErrors,
  classRows,
  reasonRows,
  offenderRows,
  agentName,
  colorScheme,
}: {
  days: number;
  totals: FailureTotals;
  dailyErrors: DailyErrorsRow[];
  classRows: FailureClassRow[];
  reasonRows: FailureReasonRow[];
  offenderRows: AgentFailureRow[];
  agentName: (agentId: string) => string;
  colorScheme: "light" | "dark";
}) {
  const { t } = useTranslation();
  const muted = THEME[colorScheme].mutedForeground;

  // Affected-agent count is the offender-row count so the tile and the list
  // can never disagree (web parity).
  const affectedAgents = offenderRows.length;
  const worst = offenderRows[0];
  const worstName = worst
    ? worst.agentId === UNRESOLVED_AGENTS_ROW_ID
      ? t("usage.errors.otherAgents")
      : agentName(worst.agentId)
    : null;

  return (
    <View className="mt-3 px-4 gap-3">
      <View className="flex-row gap-3">
        <KpiCard
          icon="close-circle-outline"
          label={t("usage.errors.kpiFailedLabel", { days })}
          value={String(totals.failed)}
          hint={t("usage.errors.kpiFailedHint", { total: totals.total })}
        />
        <KpiCard
          icon="alert-circle-outline"
          label={t("usage.errors.kpiRateLabel", { days })}
          value={formatRate(totals.failed, totals.total)}
          hint={t("usage.errors.summary", {
            failed: totals.failed,
            total: totals.total,
            rate: formatRate(totals.failed, totals.total),
          })}
        />
        <KpiCard
          icon="people-outline"
          label={t("usage.errors.kpiAgentsLabel", { days })}
          value={String(affectedAgents)}
          hint={
            worst && worstName
              ? t("usage.errors.kpiAgentsHint", { name: worstName, count: worst.failed })
              : undefined
          }
        />
      </View>

      {totals.failed === 0 ? (
        <View className="items-center gap-2 py-12">
          <Ionicons name="alert-circle-outline" size={32} color={muted} />
          <Text className="text-center text-xs text-muted-foreground">
            {t("usage.errors.noData")}
          </Text>
        </View>
      ) : (
        <>
          <ErrorTrendSection rows={dailyErrors} colorScheme={colorScheme} />
          <ErrorMixCard
            totals={totals}
            classRows={classRows}
            reasonRows={reasonRows}
            colorScheme={colorScheme}
          />
          <OffendersCard rows={offenderRows} agentName={agentName} colorScheme={colorScheme} />
        </>
      )}
    </View>
  );
}

/** Failures over time, on the same per-day bar style as the Trend tab. */
function ErrorTrendSection({
  rows,
  colorScheme,
}: {
  rows: DailyErrorsRow[];
  colorScheme: "light" | "dark";
}) {
  const { t } = useTranslation();
  const destructive = THEME[colorScheme].destructive;
  const max = rows.reduce((m, r) => Math.max(m, r.failed), 0);
  const labelEvery = rows.length > 8 ? 2 : 1;

  return (
    <View className="rounded-xl border border-border bg-card p-3">
      <Text className="mb-3 text-xs font-medium text-foreground">
        {t("usage.errors.trendTitle")}
      </Text>
      {rows.length === 0 ? (
        <Text className="text-xs text-muted-foreground">{t("usage.noData")}</Text>
      ) : (
        <View className="flex-row items-end gap-1.5" style={{ height: CHART_HEIGHT + 22 }}>
          {rows.map((d, i) => {
            const h = max > 0 ? Math.max((d.failed / max) * CHART_HEIGHT, 2) : 2;
            return (
              <View key={d.date} className="flex-1 items-center gap-1">
                <View
                  style={{
                    height: h,
                    borderTopLeftRadius: 4,
                    borderTopRightRadius: 4,
                    backgroundColor: destructive,
                    opacity: d.failed > 0 ? 0.85 : 0.15,
                    width: "100%",
                    maxWidth: 26,
                  }}
                />
                {i % labelEvery === 0 ? (
                  <Text className="text-[9px] text-muted-foreground" numberOfLines={1}>
                    {d.label}
                  </Text>
                ) : (
                  <Text className="text-[9px] text-transparent" numberOfLines={1}>
                    ·
                  </Text>
                )}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

/** What kind of thing broke: the class mix, with the raw error codes one tap
 *  away. */
function ErrorMixCard({
  totals,
  classRows,
  reasonRows,
  colorScheme,
}: {
  totals: FailureTotals;
  classRows: FailureClassRow[];
  reasonRows: FailureReasonRow[];
  colorScheme: "light" | "dark";
}) {
  const { t } = useTranslation();
  const [showReasons, setShowReasons] = useState(false);
  const colors = failureClassColors(THEME[colorScheme].destructive, THEME[colorScheme].card);
  const classLabel = (c: FailureClass) => t(FAILURE_CLASS_KEY[c]);

  return (
    <View className="rounded-xl border border-border bg-card">
      <View className="flex-row items-center justify-between border-b border-border/60 px-4 pb-2 pt-3">
        <Text className="text-xs font-medium text-foreground">
          {t("usage.errors.mixTitle", { failed: totals.failed })}
        </Text>
        <Pressable onPress={() => setShowReasons((v) => !v)} hitSlop={8}>
          <Text className="text-[11px] text-muted-foreground underline">
            {showReasons ? t("usage.errors.hideReasons") : t("usage.errors.showReasons")}
          </Text>
        </Pressable>
      </View>
      <View className="p-4">
        {showReasons ? (
          <ReasonList rows={reasonRows} colors={colors} />
        ) : (
          <ClassComposition rows={classRows} classLabel={classLabel} colors={colors} />
        )}
      </View>
    </View>
  );
}

/**
 * Class breakdown as one 100%-stacked bar plus a legend. Segments ordered by
 * count desc (the aggregator's order) so the bar reads heaviest-first.
 */
function ClassComposition({
  rows,
  classLabel,
  colors,
}: {
  rows: FailureClassRow[];
  classLabel: (c: FailureClass) => string;
  colors: Record<FailureClass, string>;
}) {
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  if (total === 0) return null;

  return (
    <View className="gap-2.5">
      <View className="h-2 w-full flex-row overflow-hidden rounded-full bg-muted">
        {rows.map((row) => (
          <View
            key={row.failureClass}
            style={{
              width: `${(row.count / total) * 100}%`,
              backgroundColor: colors[row.failureClass],
            }}
          />
        ))}
      </View>
      <View className="flex-row flex-wrap gap-x-4 gap-y-1.5">
        {rows.map((row) => (
          <View key={row.failureClass} className="flex-row items-center gap-1.5">
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                backgroundColor: colors[row.failureClass],
              }}
            />
            <Text className="text-[11px] text-foreground">{classLabel(row.failureClass)}</Text>
            <Text className="text-[11px] text-muted-foreground">{row.count}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * Raw `failure_reason` values behind the class summary. Unlocalised on
 * purpose: they are the backend's wire enum, and an operator pasting one
 * into a log search needs the exact string.
 */
function ReasonList({
  rows,
  colors,
}: {
  rows: FailureReasonRow[];
  colors: Record<FailureClass, string>;
}) {
  return (
    <View className="gap-1.5">
      {rows.map((row) => (
        <View key={row.reason} className="flex-row items-center justify-between gap-2">
          <View className="min-w-0 flex-1 flex-row items-center gap-2">
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                backgroundColor: colors[row.failureClass],
              }}
            />
            <Text className="text-[11px] text-muted-foreground" numberOfLines={1}>
              {row.reason}
            </Text>
          </View>
          <Text className="text-[11px] tabular-nums text-foreground">{row.count}</Text>
        </View>
      ))}
    </View>
  );
}

/** Top Offenders list: rank, stacked per-class bars, Failed/Rate sort toggle,
 *  TOP-8 collapse and small-sample disclaimers (web parity). */
function OffendersCard({
  rows,
  agentName,
  colorScheme,
}: {
  rows: AgentFailureRow[];
  agentName: (agentId: string) => string;
  colorScheme: "light" | "dark";
}) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const [sortBy, setSortBy] = useState<OffenderSort>("failed");

  const sorted = useMemo(() => sortAgentFailures(rows, sortBy), [rows, sortBy]);
  // The leader fills the track, measured over every row rather than the
  // visible ones (web parity) so a bar means the same thing collapsed and
  // expanded.
  const leader = sorted[0];
  const maxValue = leader ? OFFENDER_METRIC[sortBy](leader) : 0;
  const visible = showAll ? sorted : sorted.slice(0, TOP_OFFENDER_LIMIT);
  const offenderName = (agentId: string) =>
    agentId === UNRESOLVED_AGENTS_ROW_ID
      ? t("usage.errors.otherAgents")
      : agentName(agentId);

  return (
    <View className="rounded-xl border border-border bg-card">
      <View className="flex-row flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 pb-2 pt-3">
        <Text className="text-xs font-medium text-foreground">{t("usage.errors.byAgent")}</Text>
        <View className="flex-row items-center gap-1.5">
          <Text className="text-[10px] text-muted-foreground">{t("usage.errors.sortLabel")}</Text>
          <SortPill
            active={sortBy === "failed"}
            label={t("usage.errors.sortFailed")}
            onPress={() => setSortBy("failed")}
          />
          <SortPill
            active={sortBy === "rate"}
            label={t("usage.errors.sortRate")}
            onPress={() => setSortBy("rate")}
          />
        </View>
      </View>
      {sorted.length > 0 ? (
        <View className="px-4">
          <View className="flex-row items-center gap-2 border-b border-border/60 py-2">
            <View className="w-5" />
            <Text className="flex-1 text-[10px] font-medium text-muted-foreground">
              {t("usage.errors.headerAgent")}
            </Text>
            <Text
              className={cn(
                "w-12 text-right text-[10px] font-medium",
                sortBy === "failed" ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {t("usage.errors.headerFailed")}
            </Text>
            <Text className="w-12 text-right text-[10px] font-medium text-muted-foreground">
              {t("usage.errors.headerRuns")}
            </Text>
            <Text
              className={cn(
                "w-14 text-right text-[10px] font-medium",
                sortBy === "rate" ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {t("usage.errors.headerRate")}
            </Text>
          </View>
          {visible.map((row) => (
            <OffenderRow
              key={row.agentId}
              row={row}
              name={offenderName(row.agentId)}
              maxValue={maxValue}
              sortBy={sortBy}
              colorScheme={colorScheme}
            />
          ))}
          {sorted.length > TOP_OFFENDER_LIMIT ? (
            <Pressable onPress={() => setShowAll((v) => !v)} className="py-2.5" hitSlop={8}>
              <Text className="text-center text-[11px] text-muted-foreground underline">
                {showAll
                  ? t("usage.errors.showLess", { count: TOP_OFFENDER_LIMIT })
                  : t("usage.errors.showAll", { count: sorted.length })}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function SortPill({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={cn("rounded-full px-2.5 py-1", active ? "bg-foreground" : "bg-muted")}
    >
      <Text
        className={cn(
          "text-[10px] font-medium",
          active ? "text-background" : "text-muted-foreground",
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * One offender row: identity, a proportional per-class stacked bar, then one
 * column per number. The bar measures whatever the list is sorted by, and the
 * matching column is emphasised (web parity, incl. the white-emphasis rule:
 * a demoted small-sample row never takes the emphasis under Rate).
 */
function OffenderRow({
  row,
  name,
  maxValue,
  sortBy,
  colorScheme,
}: {
  row: AgentFailureRow;
  name: string;
  maxValue: number;
  sortBy: OffenderSort;
  colorScheme: "light" | "dark";
}) {
  const { t } = useTranslation();
  const colors = failureClassColors(THEME[colorScheme].destructive, THEME[colorScheme].card);
  const unresolved = row.agentId === UNRESOLVED_AGENTS_ROW_ID;

  const segments = FAILURE_CLASSES.filter((c) => row.classes[c] > 0);
  const value = OFFENDER_METRIC[sortBy](row);
  // Clamped, not just scaled: under the Rate ranking a small-sample row is
  // demoted below the leader while still able to carry a higher rate, and an
  // unclamped width would overflow the track (web parity).
  const pct = maxValue > 0 ? Math.min(100, (value / maxValue) * 100) : 0;
  const weakSample = !hasRateSample(row);

  return (
    <View className="border-b border-border/60 py-2.5">
      <View className="flex-row items-center gap-2">
        <View className="w-5">
          {unresolved ? (
            <Ionicons name="archive-outline" size={16} color={THEME[colorScheme].mutedForeground} />
          ) : (
            <ActorAvatar type="agent" id={row.agentId} size={20} />
          )}
        </View>
        <View className="flex-1">
          <Text
            className={cn(
              "text-xs",
              unresolved ? "italic text-muted-foreground" : "font-medium text-foreground",
            )}
            numberOfLines={1}
          >
            {name}
          </Text>
          <View className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <View
              style={{
                width: `${pct}%`,
                height: "100%",
                flexDirection: "row",
                overflow: "hidden",
                borderRadius: 999,
              }}
            >
              {segments.map((c) => (
                <View
                  key={c}
                  style={{
                    flex: row.classes[c] / row.failed,
                    backgroundColor: colors[c],
                  }}
                />
              ))}
            </View>
          </View>
        </View>
        <Text
          className={cn(
            "w-12 text-right text-xs tabular-nums",
            sortBy === "failed" ? "font-semibold text-foreground" : "text-muted-foreground",
          )}
        >
          {row.failed}
        </Text>
        <Text className="w-12 text-right text-xs tabular-nums text-muted-foreground">
          {row.total}
        </Text>
        <Text
          className={cn(
            "w-14 text-right text-xs tabular-nums",
            sortBy === "rate" && !weakSample
              ? "font-semibold text-foreground"
              : "text-muted-foreground",
          )}
        >
          {formatRate(row.failed, row.total)}
        </Text>
      </View>
      {weakSample ? (
        <Text className="mt-1 text-[9px] text-muted-foreground/70">
          {t("usage.errors.lowSample", { count: MIN_RATE_SAMPLE })}
        </Text>
      ) : null}
    </View>
  );
}