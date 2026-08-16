/**
 * Workspace usage screen (push screen reached from the More popover).
 * Mirrors web `packages/views/dashboard` Usage surface — the two rollups
 * mobile can render without the cost/run-time endpoints this backend lacks
 * (agent-run-time / failures return 404 on mu.zztweb.top):
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
 *
 * Layout divergence from web is deliberate and phone-sized: tabs replace the
 * web dashboard split, and a 7/30-day segmented control replaces the
 * full-width date-range picker — same queries, same aggregation, fewer pixels.
 */
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Stack } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { dashboardUsageDailyOptions, dashboardUsageByAgentOptions } from "@/data/queries/usage";
import { api } from "@/data/api";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  activeAgentCount,
  aggregateByAgent,
  aggregateDailyTokens,
  bucketUnknownAgentRows,
  computeDailyTotals,
  DELETED_AGENTS_ROW_ID,
  formatTokens,
  isSyntheticAgentRow,
  RESTRICTED_AGENTS_ROW_ID,
  type AgentUsageRow,
  type UsageDailyAggregate,
} from "@/lib/usage-format";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

type Range = 7 | 30;
type ViewMode = "trend" | "leaderboard";

const RANGES: Range[] = [7, 30];

const CHART_HEIGHT = 112;

export default function UsagePage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;

  const [range, setRange] = useState<Range>(7);
  const [mode, setMode] = useState<ViewMode>("trend");

  const daily = useQuery(dashboardUsageDailyOptions(wsId, range));
  const byAgent = useQuery(dashboardUsageByAgentOptions(wsId, range));
  // include_archived so a retired agent keeps its name on the leaderboard
  // instead of collapsing into the deleted bucket (web parity).
  const agents = useQuery({
    queryKey: ["agents", wsId, "usage"] as const,
    queryFn: ({ signal }) => api.listAgents({ signal, includeArchived: true }),
    enabled: !!wsId,
  });

  const isLoading = daily.isLoading || byAgent.isLoading || agents.isLoading;
  const error = daily.error ?? byAgent.error ?? agents.error;

  const dailyRows = useMemo(
    () => aggregateDailyTokens(daily.data ?? []),
    [daily.data],
  );
  const totals = useMemo(
    () => computeDailyTotals(daily.data ?? []),
    [daily.data],
  );

  const agentRows = useMemo(() => {
    const known = agents.data ? new Set(agents.data.map((a) => a.id)) : null;
    return bucketUnknownAgentRows(aggregateByAgent(byAgent.data ?? []), known);
  }, [byAgent.data, agents.data]);

  const agentName = useMemo(() => {
    const byId = new Map((agents.data ?? []).map((a) => [a.id, a.name]));
    return (agentId: string): string => {
      if (agentId === RESTRICTED_AGENTS_ROW_ID) return t("usage.otherAgents");
      if (agentId === DELETED_AGENTS_ROW_ID) return t("usage.deletedAgents");
      return byId.get(agentId) ?? t("usage.unknownAgent");
    };
  }, [agents.data, t]);

  const agentCount = useMemo(
    () => activeAgentCount(agentRows),
    [agentRows],
  );

  const maxDaily = useMemo(
    () => dailyRows.reduce((m, d) => Math.max(m, d.total), 0),
    [dailyRows],
  );
  const maxAgent = useMemo(
    () => agentRows.reduce((m, r) => Math.max(m, r.tokens), 0),
    [agentRows],
  );

  const showEmpty =
    !isLoading && !error && dailyRows.length === 0 && agentRows.length === 0;

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
            <Button variant="outline" onPress={() => daily.refetch().then(() => byAgent.refetch())}>
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
                refreshing={daily.isRefetching || byAgent.isRefetching}
                onRefresh={() => {
                  void daily.refetch();
                  void byAgent.refetch();
                }}
              />
            }
          >
            {/* Time range segmented control */}
            <View className="flex-row items-center px-4 pt-3 pb-1">
              <View className="flex-row items-center gap-2">
                {RANGES.map((r) => {
                  const active = range === r;
                  return (
                    <Pressable
                      key={r}
                      onPress={() => setRange(r)}
                      className={cn(
                        "rounded-full px-3 py-1",
                        active ? "bg-foreground" : "bg-muted",
                      )}
                    >
                      <Text
                        className={cn(
                          "text-xs font-medium",
                          active ? "text-background" : "text-muted-foreground",
                        )}
                      >
                        {r === 7 ? t("usage.range7") : t("usage.range30")}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* KPI tiles */}
            <View className="flex-row gap-3 px-4 py-3">
              <KpiCard
                icon="flash"
                label={t("usage.totalTokens")}
                value={formatTokens(totals.total)}
              />
              <KpiCard
                icon="checkmark-circle-outline"
                label={t("usage.totalTasks")}
                value={String(totals.taskCount)}
              />
              <KpiCard
                icon="people-outline"
                label={t("usage.agents")}
                value={String(agentCount)}
              />
            </View>

            {/* View mode segmented control */}
            <View className="flex-row gap-2 px-4">
              <ModePill active={mode === "trend"} label="usage.trendTab" onPress={() => setMode("trend")} />
              <ModePill
                active={mode === "leaderboard"}
                label="usage.leaderboardTab"
                onPress={() => setMode("leaderboard")}
              />
            </View>

            {mode === "trend" ? (
              <TrendSection
                rows={dailyRows}
                max={maxDaily}
                colorScheme={colorScheme}
              />
            ) : (
              <LeaderboardSection
                rows={agentRows}
                max={maxAgent}
                agentName={agentName}
                colorScheme={colorScheme}
              />
            )}
          </ScrollView>
        )}
      </View>
    </>
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
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  value: string;
}) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <View className="flex-1 rounded-xl border border-border bg-card px-3 py-2.5">
      <View className="flex-row items-center gap-1.5">
        <Ionicons name={icon} size={13} color={theme.mutedForeground} />
        <Text className="text-[11px] text-muted-foreground" numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text className="mt-1 text-lg font-semibold text-foreground" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function TrendSection({
  rows,
  max,
  colorScheme,
}: {
  rows: UsageDailyAggregate[];
  max: number;
  colorScheme: "light" | "dark";
}) {
  const { t } = useTranslation();
  const muted = THEME[colorScheme].mutedForeground;
  const brand = THEME[colorScheme].brand;

  const labelEvery = rows.length > 8 ? 2 : 1;

  return (
    <View className="mt-3 px-4 gap-3">
      <View className="rounded-xl border border-border bg-card p-3">
        <Text className="text-xs font-medium text-foreground mb-3">
          {t("usage.dayTrendTitle")}
        </Text>
        {rows.length === 0 ? (
          <Text className="text-xs text-muted-foreground">{t("usage.noData")}</Text>
        ) : (
          <View className="flex-row items-end gap-1.5" style={{ height: CHART_HEIGHT + 22 }}>
            {rows.map((d) => {
              const h = max > 0 ? Math.max((d.total / max) * CHART_HEIGHT, 2) : 2;
              const i = rows.indexOf(d);
              return (
                <View key={d.date} className="flex-1 items-center gap-1">
                  <View
                    style={{
                      height: h,
                      borderTopLeftRadius: 4,
                      borderTopRightRadius: 4,
                      backgroundColor: brand,
                      opacity: d.total > 0 ? 0.85 : 0.15,
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

      {/* Daily breakdown rows (input / output / cache / total per day) */}
      <View className="rounded-xl border border-border bg-card px-3">
        {rows.map((d, idx) => (
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
            <TokenCell label={t("usage.cacheLabel")} value={d.cacheRead + d.cacheWrite} muted={muted} />
            <Text className="w-16 text-right text-xs font-semibold text-foreground">
              {formatTokens(d.total)}
            </Text>
          </View>
        ))}
      </View>
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
  rows: AgentUsageRow[];
  max: number;
  agentName: (agentId: string) => string;
  colorScheme: "light" | "dark";
}) {
  const { t } = useTranslation();
  const brand = THEME[colorScheme].brand;

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
              <View className="w-12 items-end">
                <Text className="text-xs text-muted-foreground">{r.taskCount}</Text>
                <Text className="text-[9px] text-muted-foreground/70">{t("usage.tasksShort")}</Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}