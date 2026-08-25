/**
 * Runtime detail usage section (iteration-93 MYS-676, rebuilt iteration-103
 * MYS-712) — web packages/views/runtimes/components/usage-section.tsx on a
 * phone. Fetches a 180-day usage cache once, slices client-side into the
 * selected window + the immediately-prior window (delta math), and renders:
 *
 *   - dimension (daily / weekly) + period (7/30/90/180d by dimension) pills
 *   - KPI row: cost (with vs-prev delta) · cache savings (hit-rate) · tokens
 *   - custom-pricing entry bar + dialog (unmapped-model rates, local store)
 *   - WHEN card: daily/weekly stacked cost|tokens bars + 26-week heatmap
 *   - WHO/WHAT: cost-by-agent / cost-by-model ranked bars
 *   - folded per-day raw breakdown table
 *
 * All cost math lives in lib/runtime-usage.ts (shared rate table with web), so
 * the numbers agree with the web runtime detail page for the same rows.
 * Charts are pure RN Views — no chart library dependency.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { TextField } from "@/components/ui/text-field";
import { runtimeUsageByAgentOptions, runtimeUsageOptions } from "@/data/queries/runtimes";
import { agentListOptions } from "@/data/queries/agents";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { formatTokens } from "@/lib/usage-format";
import type { RuntimeUsage } from "@multica/core/types";
import {
  aggregateByDate,
  aggregateByWeek,
  aggregateCostByAgent,
  aggregateCostByModel,
  collectUnmappedModels,
  computeHeatmapCells,
  computeRuntimeTotals,
  formatUsd,
  pctChange,
  sliceWindow,
  type HeatmapData,
} from "@/lib/runtime-usage";
import {
  removeCustomPricing,
  setCustomPricing,
  useCustomPricingStore,
  type CustomModelPricing,
} from "@/lib/custom-pricing-store";

type Dim = "daily" | "weekly";
type Metric = "cost" | "tokens";
type PeriodDays = 7 | 30 | 90 | 180;

// Single source of truth for the period selector (web TIME_RANGES). 7 days at
// weekly grain is one bar, so 7d is daily-only; 180d is weekly-only because
// 180 daily bars are unreadable on a phone.
const TIME_RANGES: { label: string; days: PeriodDays; dims: readonly Dim[] }[] = [
  { label: "7d", days: 7, dims: ["daily"] },
  { label: "30d", days: 30, dims: ["daily", "weekly"] },
  { label: "90d", days: 90, dims: ["daily", "weekly"] },
  { label: "180d", days: 180, dims: ["weekly"] },
];

const DEFAULT_DAYS_BY_DIM: Record<Dim, PeriodDays> = { daily: 30, weekly: 90 };

const SEGMENT_COLORS = {
  input: "chart1",
  output: "chart2",
  cacheRead: "chart4",
  cacheWrite: "chart3",
} as const;

// ---------------------------------------------------------------------------
// Small pill segmented control (web Segmented parity).
// ---------------------------------------------------------------------------

function Segmented<T extends string | number>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { label: string; value: T }[];
}) {
  return (
    <View className="flex-row rounded-md bg-secondary p-0.5">
      {options.map((o) => (
        <Pressable
          key={String(o.value)}
          onPress={() => onChange(o.value)}
          className={cn("rounded px-2 py-0.5", o.value === value && "bg-card shadow-sm")}
        >
          <Text
            className={cn(
              "text-xs font-medium",
              o.value === value ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {o.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Top-level orchestrator — owns dim / period state, caches a 180-day fetch,
// slices windows, threads everything into the four visual blocks below.
// ---------------------------------------------------------------------------

export function RuntimeUsageSection({ runtimeId }: { runtimeId: string }) {
  // Subscribe so the KPI cards (estimateCost at render-time) and the memoized
  // aggregates re-evaluate when the user saves a custom rate.
  useCustomPricingStore((s) => s.pricings);

  const tz = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    [],
  );
  const { data: usage = [], isLoading } = useQuery(
    runtimeUsageOptions(runtimeId, 180, tz),
  );

  const [dim, setDim] = useState<Dim>("daily");
  const [days, setDays] = useState<PeriodDays>(30);

  if (isLoading) return <UsageSkeleton />;
  if (usage.length === 0) return <UsageEmpty />;

  const handleDimChange = (next: Dim) => {
    setDim(next);
    const stillAllowed = TIME_RANGES.some((r) => r.days === days && r.dims.includes(next));
    if (!stillAllowed) setDays(DEFAULT_DAYS_BY_DIM[next]);
  };

  return <SectionBody runtimeId={runtimeId} usage={usage} tz={tz} dim={dim} days={days} setDim={handleDimChange} setDays={setDays} />;
}

function SectionBody({
  runtimeId,
  usage,
  tz,
  dim,
  days,
  setDim,
  setDays,
}: {
  runtimeId: string;
  usage: RuntimeUsage[];
  tz: string;
  dim: Dim;
  days: PeriodDays;
  setDim: (d: Dim) => void;
  setDays: (d: PeriodDays) => void;
}) {
  const { t } = useTranslation();
  // Subscribe so custom-rate changes re-render this body (estimates below are
  // computed at render-time, matching web — memoizing them on `filtered` would
  // cache pre-override totals when the query data hasn't changed).
  useCustomPricingStore((s) => s.pricings);

  // Slice the cached 180-day window into the selected period AND the prior
  // window of equal length, for the KPI delta.
  const { filtered, prevFiltered } = useMemo(
    () => sliceWindow(usage, days, tz),
    [usage, days, tz],
  );
  const totals = computeRuntimeTotals(filtered);
  const prevTotals = computeRuntimeTotals(prevFiltered);
  const costDelta = pctChange(totals.cost, prevTotals.cost);

  const allowedRanges = TIME_RANGES.filter((r) => r.dims.includes(dim));

  const tokensTotal =
    totals.input + totals.output + totals.cacheRead + totals.cacheWrite;
  const cacheable = totals.input + totals.cacheRead;
  const cacheHitRate =
    cacheable > 0 ? Math.round((totals.cacheRead / cacheable) * 100) : 0;

  return (
    <View className="mt-4 gap-4">
      {/* Page-wide period selector. */}
      <View className="flex-row flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
        <View className="flex-row items-center gap-2">
          <Text className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {t("runtimes.usage.dimension_label")}
          </Text>
          <Segmented<Dim>
            value={dim}
            onChange={setDim}
            options={[
              { label: t("runtimes.usage.when_tab_daily"), value: "daily" },
              { label: t("runtimes.usage.when_tab_weekly"), value: "weekly" },
            ]}
          />
        </View>
        <View className="flex-row items-center gap-2">
          <Text className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {t("runtimes.usage.period_label")}
          </Text>
          <Segmented<PeriodDays>
            value={days}
            onChange={setDays}
            options={allowedRanges.map((r) => ({ label: r.label, value: r.days }))}
          />
        </View>
      </View>

      {/* Custom-pricing entry bar */}
      <CustomPricingBar usage={filtered} />

      {/* KPI row — cost (delta) / cache savings / tokens */}
      <View className="flex-row gap-2">
        <KpiCard
          icon="cash-outline"
          label={t("runtimes.usage.kpi_cost_label", { days })}
          value={formatUsd(totals.cost)}
          delta={costDelta}
        />
        <KpiCard
          icon="server-outline"
          label={t("runtimes.usage.kpi_cache_label", { days })}
          value={formatUsd(totals.cacheSavings)}
          hint={t("runtimes.usage.kpiCacheHint", {
            pct: cacheHitRate,
            reads: formatTokens(totals.cacheRead),
          })}
          accent={totals.cacheSavings > 0}
        />
        <KpiCard
          icon="flash-outline"
          label={t("runtimes.usage.kpi_tokens_label", { days })}
          value={formatTokens(tokensTotal)}
          hint={t("runtimes.usage.kpiTokensHint", {
            input: formatTokens(totals.input),
            output: formatTokens(totals.output),
          })}
        />
      </View>

      {/* WHEN chart */}
      <WhenChartCard usage={usage} filtered={filtered} days={days} dim={dim} tz={tz} />

      {/* WHO/WHAT spent it */}
      <CostByBlock runtimeId={runtimeId} days={days} usage={filtered} tz={tz} />

      {/* Folded raw breakdown table */}
      <FoldedRow usage={filtered} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// KPI card
// ---------------------------------------------------------------------------

function KpiCard({
  icon,
  label,
  value,
  hint,
  delta,
  accent,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  value: string;
  hint?: string;
  delta?: number | null;
  accent?: boolean;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <View className="flex-1 rounded-xl border border-border bg-card px-2.5 py-2.5">
      <View className="flex-row items-center gap-1.5">
        <Ionicons name={icon} size={13} color={theme.mutedForeground} />
        <Text
          className="text-[10px] text-muted-foreground"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
        >
          {label}
        </Text>
      </View>
      <Text
        className="mt-1 text-base font-semibold text-foreground"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {value}
      </Text>
      {hint ? (
        <Text
          className="mt-0.5 text-[10px] text-muted-foreground/70"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {hint}
        </Text>
      ) : delta != null ? (
        <Text
          className={cn(
            "mt-0.5 text-[10px] font-medium",
            delta > 0 ? "text-warning" : delta < 0 ? "text-success" : "text-muted-foreground",
          )}
        >
          {t("runtimes.usage.kpi_cost_delta", { sign: delta > 0 ? "+" : "", pct: delta })}
        </Text>
      ) : accent ? (
        <Text className="mt-0.5 text-[10px] text-success">✓</Text>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Custom pricing entry bar + dialog (web CustomPricingBar / CustomPricingDialog)
// ---------------------------------------------------------------------------

function CustomPricingBar({ usage }: { usage: RuntimeUsage[] }) {
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const hasOverrides = useCustomPricingStore((s) => Object.keys(s.pricings).length > 0);
  // Computed at render-time so saving a rate drops the model out of this list
  // immediately (web CustomPricingBar parity).
  const unmapped = collectUnmappedModels(usage);
  if (unmapped.length === 0 && !hasOverrides) return null;

  const hasGap = unmapped.length > 0;
  return (
    <View
      className={cn(
        "flex-row flex-wrap items-center gap-2 rounded-lg border px-3 py-2",
        hasGap ? "border-warning/30 bg-warning/10" : "bg-secondary/40",
      )}
    >
      {hasGap ? (
        <>
          <Ionicons name="alert-circle-outline" size={15} color={theme.warning} />
          <View className="min-w-0 flex-1">
            <Text className="text-[11px] text-foreground">
              {plural(t, "runtimes.usage.unmapped_notice", unmapped.length, {
                count: unmapped.length,
              })}
            </Text>
            <Text className="mt-0.5 text-[10px] text-muted-foreground" numberOfLines={1}>
              {unmapped.join(", ")}
            </Text>
          </View>
        </>
      ) : (
        <Text className="min-w-0 flex-1 text-[11px] text-muted-foreground">
          {t("runtimes.usage.custom_pricing.active_notice")}
        </Text>
      )}
      <Button
        variant="outline"
        size="sm"
        className="h-8 px-2.5"
        onPress={() => setDialogOpen(true)}
      >
        <Text className="text-[11px]">
          {hasGap
            ? t("runtimes.usage.custom_pricing.open_button")
            : t("runtimes.usage.custom_pricing.edit_button")}
        </Text>
      </Button>
      <CustomPricingDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        unmappedModels={unmapped}
      />
    </View>
  );
}

function plural(
  t: (id: string, p?: Record<string, string | number>) => string,
  base: string,
  count: number,
  params?: Record<string, string | number>,
): string {
  const key = count === 1 ? `${base}_one` : `${base}_other`;
  return t(key, { count, ...params });
}

type DraftRow = { input: string; output: string; cacheRead: string; cacheWrite: string };
const EMPTY_DRAFT: DraftRow = { input: "", output: "", cacheRead: "", cacheWrite: "" };

function toDraft(p: CustomModelPricing | undefined): DraftRow {
  if (!p) return EMPTY_DRAFT;
  return {
    input: String(p.input),
    output: String(p.output),
    cacheRead: String(p.cacheRead),
    cacheWrite: String(p.cacheWrite),
  };
}

function parseDraft(draft: DraftRow): CustomModelPricing | null {
  const values = [draft.input, draft.output, draft.cacheRead, draft.cacheWrite].map((s) =>
    Number(s.trim()),
  );
  if (values.some((n) => !Number.isFinite(n) || n < 0)) return null;
  const [input, output, cacheRead, cacheWrite] = values as [number, number, number, number];
  return { input, output, cacheRead, cacheWrite };
}

function CustomPricingDialog({
  open,
  onOpenChange,
  unmappedModels,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unmappedModels: readonly string[];
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const insets = useSafeAreaInsets();
  const pricings = useCustomPricingStore((s) => s.pricings);
  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({});

  // Show every unmapped model plus everything already in the store, so a
  // user revisiting after saving can still tweak / remove their entries.
  const rows = useMemo(
    () =>
      Array.from(new Set([...unmappedModels, ...Object.keys(pricings)])).sort(),
    [unmappedModels, pricings],
  );

  // Reset drafts whenever the dialog opens so stale half-typed values from a
  // previous session don't persist into a fresh edit.
  useEffect(() => {
    if (!open) return;
    const fresh: Record<string, DraftRow> = {};
    for (const key of rows) fresh[key] = toDraft(pricings[key]);
    setDrafts(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rows.join("\n")]);

  const updateField = (key: string, field: keyof DraftRow, value: string) => {
    setDrafts((d) => ({
      ...d,
      [key]: { ...(d[key] ?? EMPTY_DRAFT), [field]: value },
    }));
  };

  const handleSave = () => {
    for (const key of rows) {
      const draft = drafts[key] ?? EMPTY_DRAFT;
      const parsed = parseDraft(draft);
      const allEmpty =
        draft.input.trim() === "" &&
        draft.output.trim() === "" &&
        draft.cacheRead.trim() === "" &&
        draft.cacheWrite.trim() === "";
      if (allEmpty) {
        if (pricings[key]) removeCustomPricing(key);
        continue;
      }
      if (parsed) setCustomPricing(key, parsed);
    }
    onOpenChange(false);
  };

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => onOpenChange(false)}>
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View className="flex-row items-center gap-3 border-b border-border px-4 py-3">
          <View className="size-8 items-center justify-center rounded-lg bg-secondary">
            <Ionicons name="pricetag-outline" size={15} color={theme.mutedForeground} />
          </View>
          <View className="flex-1">
            <Text className="text-base font-semibold text-foreground">
              {t("runtimes.usage.custom_pricing.title")}
            </Text>
          </View>
          <Pressable onPress={() => onOpenChange(false)} accessibilityLabel={t("runtimes.usage.custom_pricing.cancel")} hitSlop={8}>
            <Ionicons name="close" size={20} color={theme.mutedForeground} />
          </Pressable>
        </View>

        <ScrollView className="flex-1" contentContainerClassName="px-4 py-4 gap-4">
          <Text className="text-xs text-muted-foreground leading-5">
            {t("runtimes.usage.custom_pricing.description")}
          </Text>

          {rows.length === 0 ? (
            <Text className="py-6 text-center text-xs text-muted-foreground">
              {t("runtimes.usage.custom_pricing.empty")}
            </Text>
          ) : (
            rows.map((key) => {
              const draft = drafts[key] ?? EMPTY_DRAFT;
              const hasOverride = Boolean(pricings[key]);
              return (
                <View key={key} className="gap-2 rounded-md border border-border p-3">
                  <View className="flex-row items-center justify-between gap-2">
                    <Text className="flex-1 shrink font-mono text-xs text-foreground" numberOfLines={1}>
                      {key}
                    </Text>
                    {hasOverride && (
                      <Pressable
                        onPress={() => removeCustomPricing(key)}
                        accessibilityLabel={t("runtimes.usage.custom_pricing.remove_aria")}
                        hitSlop={8}
                      >
                        <Ionicons name="trash-outline" size={15} color={theme.mutedForeground} />
                      </Pressable>
                    )}
                  </View>
                  <View className="flex-row flex-wrap gap-2">
                    {(
                      [
                        ["input", "runtimes.usage.custom_pricing.field_input"],
                        ["output", "runtimes.usage.custom_pricing.field_output"],
                        ["cacheRead", "runtimes.usage.custom_pricing.field_cache_read"],
                        ["cacheWrite", "runtimes.usage.custom_pricing.field_cache_write"],
                      ] as const
                    ).map(([field, labelKey]) => (
                      <View key={field} className="min-w-[92px] flex-1">
                        <Text className="mb-1 text-[10px] text-muted-foreground">
                          {t(labelKey)}
                        </Text>
                        <TextField
                          value={draft[field]}
                          onChangeText={(v) => updateField(key, field, v)}
                          keyboardType="numeric"
                          placeholder="0.00"
                          className="h-9 px-2.5 text-xs"
                        />
                      </View>
                    ))}
                  </View>
                </View>
              );
            })
          )}
          <Text className="text-[10px] text-muted-foreground leading-4">
            {t("runtimes.usage.custom_pricing.unit_hint")}
          </Text>
        </ScrollView>

        <View className="flex-row gap-3 border-t border-border px-4 py-3">
          <Button variant="outline" className="flex-1" onPress={() => onOpenChange(false)}>
            <Text>{t("runtimes.usage.custom_pricing.cancel")}</Text>
          </Button>
          <Button className="flex-1" onPress={handleSave}>
            <Text>{t("runtimes.usage.custom_pricing.save")}</Text>
          </Button>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// WHEN chart — dimension handled by parent; heatmap is an independent toggle.
// ---------------------------------------------------------------------------

function WhenChartCard({
  usage,
  filtered,
  days,
  dim,
  tz,
}: {
  usage: RuntimeUsage[];
  filtered: RuntimeUsage[];
  days: number;
  dim: Dim;
  tz: string;
}) {
  const { t } = useTranslation();
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [metric, setMetric] = useState<Metric>("cost");
  const pricings = useCustomPricingStore((s) => s.pricings);

  // Memo deps include pricings so a saved custom rate re-runs the
  // aggregates (estimateCost reads the override store via the module).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const daily = useMemo(() => aggregateByDate(filtered), [filtered, pricings]);
  const weekCount = Math.max(1, Math.ceil(days / 7));
  const weekly = useMemo(
    () => aggregateByWeek(usage, tz, weekCount),
    [usage, tz, weekCount, pricings], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const heatmap = useMemo(() => computeHeatmapCells(usage, tz), [usage, tz, pricings]);

  const legendIncludeCacheRead = !showHeatmap && metric === "tokens";

  return (
    <View className="rounded-lg border border-border bg-card p-3">
      <View className="mb-3 flex-row flex-wrap items-center gap-2">
        <Text className="text-sm font-semibold text-foreground">
          {t("runtimes.usage.when_title")}
        </Text>
        {!showHeatmap && (
          <Segmented<Metric>
            value={metric}
            onChange={setMetric}
            options={[
              { label: t("runtimes.usage.daily_metric_cost"), value: "cost" },
              { label: t("runtimes.usage.daily_metric_tokens"), value: "tokens" },
            ]}
          />
        )}
        <Pressable
          onPress={() => setShowHeatmap((v) => !v)}
          className={cn(
            "ml-auto rounded-md border px-2.5 py-1",
            showHeatmap
              ? "border-foreground bg-foreground"
              : "border-border",
          )}
        >
          <Text className={cn("text-[11px] font-medium", showHeatmap ? "text-background" : "text-muted-foreground")}>
            {t("runtimes.usage.when_tab_heatmap")}
          </Text>
        </Pressable>
      </View>

      {!showHeatmap && (
        <View className="mb-2 flex-row items-center gap-3">
          {[["input", legendIncludeCacheRead], ["output", false], ["cacheRead", legendIncludeCacheRead], ["cacheWrite", true]]
            .filter(([, show]) => show)
            .map(([key]) => (
              <ChartLegendDot key={String(key)} kind={key as keyof typeof SEGMENT_COLORS} />
            ))}
        </View>
      )}

      {showHeatmap ? (
        <>
          <Text className="mb-2 text-center text-[10px] text-muted-foreground">
            {t("runtimes.usage.heatmap_caption")}
          </Text>
          <HeatmapView heatmap={heatmap} />
        </>
      ) : dim === "daily" ? (
        metric === "tokens" ? (
          <MetricChart
            rows={daily.dailyTokens.map((d) => ({
              label: d.label,
              parts: [
                { value: d.input, color: "chart1", kind: "input" },
                { value: d.output, color: "chart2", kind: "output" },
                { value: d.cacheRead, color: "chart4", kind: "cacheRead" },
                { value: d.cacheWrite, color: "chart3", kind: "cacheWrite" },
              ],
              total: d.input + d.output + d.cacheRead + d.cacheWrite,
            }))}
            emptyCheck={daily.dailyTokens.every((d) => d.input + d.output + d.cacheRead + d.cacheWrite === 0)}
            usage={filtered}
            isTokens
          />
        ) : (
          <MetricChart
            rows={daily.dailyCostStack.map((d) => ({
              label: d.label,
              parts: [
                { value: d.input, color: "chart1", kind: "input" },
                { value: d.output, color: "chart2", kind: "output" },
                { value: d.cacheWrite, color: "chart3", kind: "cacheWrite" },
              ],
              total: d.total,
            }))}
            emptyCheck={daily.dailyCostStack.every((d) => d.total === 0)}
            usage={filtered}
            isTokens={false}
          />
        )
      ) : metric === "tokens" ? (
        <MetricChart
          rows={weekly.weeklyTokens.map((w) => ({
            label: w.label,
            parts: [
              { value: w.input, color: "chart1", kind: "input" },
              { value: w.output, color: "chart2", kind: "output" },
              { value: w.cacheRead, color: "chart4", kind: "cacheRead" },
              { value: w.cacheWrite, color: "chart3", kind: "cacheWrite" },
            ],
            total: w.input + w.output + w.cacheRead + w.cacheWrite,
            partial: w.partial,
          }))}
          emptyCheck={weekly.weeklyTokens.every((w) => w.input + w.output + w.cacheRead + w.cacheWrite === 0)}
          usage={filtered}
          isTokens
        />
      ) : (
        <MetricChart
          rows={weekly.weeklyCostStack.map((w) => ({
            label: w.label,
            parts: [
              { value: w.input, color: "chart1", kind: "input" },
              { value: w.output, color: "chart2", kind: "output" },
              { value: w.cacheWrite, color: "chart3", kind: "cacheWrite" },
            ],
            total: w.total,
            partial: w.partial,
          }))}
          emptyCheck={weekly.weeklyCostStack.every((w) => w.total === 0)}
          usage={filtered}
          isTokens={false}
        />
      )}
    </View>
  );
}

function ChartLegendDot({ kind }: { kind: keyof typeof SEGMENT_COLORS }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const labelKey: Record<keyof typeof SEGMENT_COLORS, string> = {
    input: "runtimes.usage.legend_input",
    output: "runtimes.usage.legend_output",
    cacheRead: "runtimes.usage.legend_cache_read",
    cacheWrite: "runtimes.usage.legend_cache_write",
  };
  return (
    <View className="flex-row items-center gap-1.5">
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 2,
          backgroundColor: theme[SEGMENT_COLORS[kind]],
        }}
      />
      <Text className="text-[10px] text-muted-foreground">{t(labelKey[kind])}</Text>
    </View>
  );
}

interface ChartRow {
  label: string;
  parts: { value: number; color: string }[];
  total: number;
  partial?: boolean;
}

function MetricChart({
  rows,
  emptyCheck,
  usage,
  isTokens,
}: {
  rows: ChartRow[];
  emptyCheck: boolean;
  usage: RuntimeUsage[];
  isTokens: boolean;
}) {
  if (emptyCheck) return <EmptyChartState usage={usage} />;
  return <StackedBars rows={rows} />;
}

function StackedBars({ rows }: { rows: ChartRow[] }) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const CHART_HEIGHT = 96;
  const maxTotal = Math.max(...rows.map((r) => r.total), 0);
  const labelEvery = rows.length > 8 ? 2 : 1;
  return (
    <View className="flex-row items-end gap-1" style={{ height: CHART_HEIGHT + 20 }}>
      {rows.map((r, i) => {
        const column =
          maxTotal > 0 && r.total > 0 ? Math.max((r.total / maxTotal) * CHART_HEIGHT, 3) : 2;
        // Segment heights proportional within the bar, bottom-up input-first.
        const segHeights = r.total > 0
          ? r.parts.map((p) => Math.max(Math.round((p.value / r.total) * column), p.value > 0 ? 1 : 0))
          : r.parts.map(() => 0);
        return (
          <View key={`${r.label}-${i}`} className="flex-1 items-center gap-1">
            <View
              style={{
                height: column,
                borderRadius: 4,
                overflow: "hidden",
                opacity: r.partial ? 0.4 : 1,
                width: "100%",
                maxWidth: 26,
              }}
              className="justify-end"
            >
              {/* Render reversed so input sits at the bottom */}
              {[...r.parts].reverse().map((p, segIdx) => (
                <View
                  key={segIdx}
                  style={{
                    height: segHeights[r.parts.length - 1 - segIdx],
                    backgroundColor: theme[p.color as keyof typeof theme] as string,
                  }}
                />
              ))}
            </View>
            <Text
              className={cn("text-[9px]", i % labelEvery === 0 ? "text-muted-foreground" : "text-transparent")}
              numberOfLines={1}
            >
              {i % labelEvery === 0 ? r.label : "·"}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Empty chart state — distinguishes "no usage" vs "pricing missing" vs "$0".
// ---------------------------------------------------------------------------

function EmptyChartState({ usage }: { usage: RuntimeUsage[] }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const hasTokens = usage.some(
    (u) =>
      u.input_tokens + u.output_tokens + u.cache_read_tokens + u.cache_write_tokens > 0,
  );
  const unmapped = collectUnmappedModels(usage);
  return (
    <View className="items-center gap-1.5 rounded-md border border-dashed border-border bg-secondary/30 px-4 py-6">
      <Ionicons name="bar-chart-outline" size={18} color={theme.mutedForeground} />
      {!hasTokens ? (
        <Text className="text-center text-xs text-muted-foreground">
          {t("runtimes.usage.empty_no_usage")}
        </Text>
      ) : unmapped.length > 0 ? (
        <>
          <Text className="text-center text-xs text-muted-foreground">
            {t("runtimes.usage.empty_pricing_missing")}
          </Text>
          <Text className="font-mono text-[10px] text-foreground" numberOfLines={2}>
            {unmapped.join(", ")}
          </Text>
          <Text className="text-center text-[10px] text-muted-foreground">
            {t("runtimes.usage.empty_pricing_hint")}
          </Text>
        </>
      ) : (
        <Text className="text-center text-xs text-muted-foreground">
          {t("runtimes.usage.empty_zero_cost")}
        </Text>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Heatmap — 26-week Mon-first grid, pure RN Views (web ActivityHeatmap math).
// ---------------------------------------------------------------------------

const HEATMAP_WEEKS = 26;
const CELL = 14;
const CELL_GAP = 3;

function cellColor(theme: (typeof THEME)["light"], level: number): string {
  if (level === 0) return theme.muted;
  const opacities = ["17%", "40%", "70%", "100%"] as const;
  return colorWithAlpha(theme.brand, opacities[level - 1]!);
}

function colorWithAlpha(hsl: string, alpha: string): string {
  // hsl(225 71% 58%) → hsla(225 71% 58% / 0.4)
  return hsl.replace("hsl(", "hsla(").replace(")", ` / ${alpha})`);
}

function HeatmapView({ heatmap }: { heatmap: HeatmapData }) {
  const { t, locale } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  const weekdayLabels = useMemo(() => {
    const anchor = Date.UTC(2026, 0, 5); // Monday
    const fmt = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
      weekday: "short",
      timeZone: "UTC",
    });
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(anchor + i * 86_400_000)));
  }, [locale]);

  const weeks = useMemo(() => {
    const cols: { cells: (HeatmapData["cells"][number] | null)[] }[] = [];
    for (let w = 0; w < HEATMAP_WEEKS; w++) {
      const cells = heatmap.cells.filter((c) => c.week === w);
      const padded: (HeatmapData["cells"][number] | null)[] = [];
      for (let i = 0; i < 7; i++) padded.push(cells.find((c) => c.dayOfWeek === i) ?? null);
      cols.push({ cells: padded });
    }
    return cols;
  }, [heatmap.cells]);

  const gridWidth = HEATMAP_WEEKS * (CELL + CELL_GAP);
  const months = heatmap.monthLabels;

  return (
    <View className="gap-3">
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ width: gridWidth }}>
          {/* Month labels */}
          <View className="mb-1 h-3.5 flex-row">
            {months.map((m) => (
              <Text
                key={`${m.label}-${m.week}`}
                className="text-[9px] text-muted-foreground"
                style={{ marginLeft: m.week * (CELL + CELL_GAP), position: "absolute" }}
              >
                {m.label}
              </Text>
            ))}
          </View>
          <View className="flex-row gap-0.5">
            {/* Row labels (Mon / Wed / Fri) */}
            <View className="mr-1 w-5">
              {[0, 2, 4].map((i) => (
                <Text key={i} className="text-[8px] text-muted-foreground" style={{ height: CELL + CELL_GAP }}>
                  {weekdayLabels[i] ?? ""}
                </Text>
              ))}
            </View>
            {weeks.map((col, w) => (
              <View key={w} className="gap-0.5">
                {col.cells.map((c, i) => (
                  <View
                    key={i}
                    style={{
                      width: CELL,
                      height: CELL,
                      borderRadius: 3,
                      backgroundColor: c ? cellColor(theme, c.level) : "transparent",
                    }}
                  />
                ))}
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      {/* Legend: less → more */}
      <View className="flex-row items-center justify-center gap-1.5">
        <Text className="text-[9px] text-muted-foreground">{t("runtimes.charts.heatmap_less")}</Text>
        {[0, 1, 2, 3, 4].map((lvl) => (
          <View key={lvl} style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: cellColor(theme, lvl) }} />
        ))}
        <Text className="text-[9px] text-muted-foreground">{t("runtimes.charts.heatmap_more")}</Text>
      </View>

      <HeatmapInsights insights={heatmap.insights} weekdayLabels={weekdayLabels} />
    </View>
  );
}

function HeatmapInsights({
  insights,
  weekdayLabels,
}: {
  insights: HeatmapData["insights"];
  weekdayLabels: string[];
}) {
  const { t } = useTranslation();
  const { busiestDay, busyDayIndex, busyDayAvg, quietDayIndex, quietDayAvg, totalCost, windowDays } = insights;
  return (
    <View className="flex-row flex-wrap border-t border-border pt-2.5">
      <Insight
        label={t("runtimes.charts.heatmap_busiest_day")}
        value={busiestDay ? fmtDate(busiestDay.date) : "—"}
        sub={busiestDay ? formatUsd(busiestDay.cost) : null}
      />
      <Insight
        label={t("runtimes.charts.heatmap_most_active_weekday")}
        value={busyDayIndex === null ? "—" : (weekdayLabels[busyDayIndex] ?? "—")}
        sub={
          busyDayIndex !== null
            ? t("runtimes.charts.heatmap_average", { value: formatUsd(busyDayAvg) })
            : null
        }
      />
      <Insight
        label={t("runtimes.charts.heatmap_quietest_weekday")}
        value={quietDayIndex === null ? "—" : (weekdayLabels[quietDayIndex] ?? "—")}
        sub={
          quietDayIndex !== null
            ? t("runtimes.charts.heatmap_average", { value: formatUsd(quietDayAvg) })
            : null
        }
      />
      <Insight
        label={t("runtimes.charts.heatmap_window_total", { count: windowDays })}
        value={formatUsd(totalCost)}
      />
    </View>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function Insight({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string | null;
}) {
  return (
    <View className="min-w-0 w-1/2 pr-2 mb-2">
      <Text className="text-[9px] uppercase tracking-wider text-muted-foreground" numberOfLines={1}>
        {label}
      </Text>
      <Text className="mt-0.5 text-xs font-medium text-foreground" numberOfLines={1}>
        {value}
        {sub != null ? (
          <Text className="text-[10px] font-normal text-muted-foreground"> {sub}</Text>
        ) : null}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Cost-by block — two-tab attribution (by agent / by model).
// ---------------------------------------------------------------------------

function CostByBlock({
  runtimeId,
  days,
  usage,
  tz,
}: {
  runtimeId: string;
  days: number;
  usage: RuntimeUsage[];
  tz: string;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"agent" | "model">("agent");
  const pricings = useCustomPricingStore((s) => s.pricings);
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  const { data: byAgentRows = [] } = useQuery({
    ...runtimeUsageByAgentOptions(runtimeId, days, tz),
    enabled: tab === "agent",
  });
  const { data: agents = [] } = useQuery(agentListOptions(wsId));

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const byAgent = useMemo(() => aggregateCostByAgent(byAgentRows), [byAgentRows, pricings]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const byModel = useMemo(() => aggregateCostByModel(usage), [usage, pricings]);

  const caption =
    tab === "agent"
      ? plural(t, "runtimes.usage.cost_by_caption_agent", byAgent.length)
      : plural(t, "runtimes.usage.cost_by_caption_model", byModel.length);

  return (
    <View className="rounded-lg border border-border bg-card p-3">
      <View className="mb-3 flex-row flex-wrap items-center justify-between gap-2 border-b border-border pb-2.5">
        <View className="flex-row items-center gap-2">
          <Text className="text-sm font-semibold text-foreground">
            {tab === "agent"
              ? t("runtimes.usage.cost_by_title_agent")
              : t("runtimes.usage.cost_by_title_model")}
          </Text>
          <Segmented<"agent" | "model">
            value={tab}
            onChange={setTab}
            options={[
              { label: t("runtimes.usage.cost_by_tab_agent"), value: "agent" },
              { label: t("runtimes.usage.cost_by_tab_model"), value: "model" },
            ]}
          />
        </View>
        <Text className="text-[10px] text-muted-foreground">{caption}</Text>
      </View>

      {tab === "agent" ? (
        <CostByList rows={byAgent} renderKey={(key) => <AgentKey agentId={key} agents={agents} />} />
      ) : (
        <CostByList
          rows={byModel}
          renderKey={(key) => (
            <Text className="shrink font-mono text-[11px] text-foreground" numberOfLines={1}>
              {key}
            </Text>
          )}
        />
      )}
    </View>
  );
}

function AgentKey({ agentId, agents }: { agentId: string; agents: { id: string; name?: string }[] }) {
  const agent = agents.find((a) => a.id === agentId);
  return (
    <View className="min-w-0 flex-row items-center gap-1.5">
      <ActorAvatar type="agent" id={agentId} size={18} />
      <Text className="shrink text-xs font-medium text-foreground" numberOfLines={1}>
        {agent?.name ?? agentId}
      </Text>
    </View>
  );
}

function CostByList({
  rows,
  renderKey,
}: {
  rows: ReturnType<typeof aggregateCostByModel>;
  renderKey: (key: string) => React.ReactNode;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  if (rows.length === 0) {
    return (
      <Text className="py-5 text-center text-xs text-muted-foreground">
        {t("runtimes.usage.empty_no_usage")}
      </Text>
    );
  }
  const maxCost = Math.max(...rows.map((r) => r.cost), 0);
  return (
    <View className="gap-1.5">
      {rows.map((row) => {
        const pct = maxCost > 0 ? (row.cost / maxCost) * 100 : 0;
        return (
          <View key={row.key} className="flex-row items-center gap-2 py-0.5">
            <View style={{ width: 84 }}>{renderKey(row.key)}</View>
            <View className="h-2 flex-[1.4] overflow-hidden rounded-full bg-secondary">
              <View style={{ width: `${pct}%`, height: "100%", borderRadius: 999, backgroundColor: theme.chart1 }} />
            </View>
            <Text className="w-14 text-right text-[10px] tabular-nums text-muted-foreground">
              {formatTokens(row.tokens)}
            </Text>
            <Text className="w-16 text-right text-xs font-medium tabular-nums text-foreground">
              {formatUsd(row.cost)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Folded per-day breakdown table.
// ---------------------------------------------------------------------------

function FoldedRow({ usage }: { usage: RuntimeUsage[] }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const [open, setOpen] = useState(false);
  return (
    <View className="border-t border-border pt-2.5">
      <Pressable
        onPress={() => setOpen((v) => !v)}
        className="flex-row items-center gap-1 self-start"
        accessibilityRole="button"
      >
        <Ionicons
          name="chevron-forward"
          size={13}
          color={theme.mutedForeground}
          style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}
        />
        <Text className="text-xs text-muted-foreground">
          {t("runtimes.usage.daily_breakdown_toggle")}
        </Text>
      </Pressable>
      {open && (
        <View className="mt-2.5 rounded-lg border border-border">
          <DailyBreakdownTable usage={usage} />
        </View>
      )}
    </View>
  );
}

function DailyBreakdownTable({ usage }: { usage: RuntimeUsage[] }) {
  const { t } = useTranslation();
  const byDate = new Map<string, RuntimeUsage[]>();
  for (const u of usage) {
    const existing = byDate.get(u.date) ?? [];
    existing.push(u);
    byDate.set(u.date, existing);
  }
  return (
    <View className="overflow-hidden rounded-lg">
      <View className="flex-row border-b border-border bg-secondary/40 px-2.5 py-1.5">
        <Text className="w-16 text-[10px] font-medium text-muted-foreground">{t("runtimes.usage.table_date")}</Text>
        <Text className="flex-1 text-[10px] font-medium text-muted-foreground">{t("runtimes.usage.table_model")}</Text>
        <Text className="w-14 text-right text-[10px] font-medium text-muted-foreground">{t("runtimes.usage.table_input")}</Text>
        <Text className="w-14 text-right text-[10px] font-medium text-muted-foreground">{t("runtimes.usage.table_output")}</Text>
        <Text className="w-12 text-right text-[10px] font-medium text-muted-foreground">{t("runtimes.usage.table_cache_r")}</Text>
        <Text className="w-12 text-right text-[10px] font-medium text-muted-foreground">{t("runtimes.usage.table_cache_w")}</Text>
      </View>
      <ScrollView className="max-h-56">
        {Array.from(byDate.entries()).map(([date, rows]) =>
          rows.map((row, i) => (
            <View
              key={`${date}-${row.model}-${i}`}
              className="flex-row items-center border-b border-border/50 px-2.5 py-1.5"
              style={{ backgroundColor: i === 0 ? "transparent" : undefined }}
            >
              <Text className="w-16 text-[10px] text-muted-foreground">{date}</Text>
              <Text className="shrink flex-1 font-mono text-[10px] text-foreground" numberOfLines={1}>
                {row.model}
              </Text>
              <Text className="w-14 text-right text-[10px] tabular-nums text-foreground">{formatTokens(row.input_tokens)}</Text>
              <Text className="w-14 text-right text-[10px] tabular-nums text-foreground">{formatTokens(row.output_tokens)}</Text>
              <Text className="w-12 text-right text-[10px] tabular-nums text-muted-foreground">{formatTokens(row.cache_read_tokens)}</Text>
              <Text className="w-12 text-right text-[10px] tabular-nums text-muted-foreground">{formatTokens(row.cache_write_tokens)}</Text>
            </View>
          )),
        )}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Loading + empty states (web UsageSkeleton / UsageEmpty)
// ---------------------------------------------------------------------------

function UsageSkeleton() {
  return (
    <View className="mt-4 gap-3">
      <View className="h-10 rounded-lg bg-secondary" />
      <View className="h-24 rounded-lg bg-secondary" />
      <View className="h-52 rounded-lg bg-secondary" />
    </View>
  );
}

function UsageEmpty() {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <View className="mt-4 items-center gap-1.5 rounded-lg border border-dashed border-border px-4 py-8">
      <Ionicons name="bar-chart-outline" size={20} color={theme.mutedForeground} />
      <Text className="text-xs text-muted-foreground">{t("runtimes.usage.no_data")}</Text>
    </View>
  );
}