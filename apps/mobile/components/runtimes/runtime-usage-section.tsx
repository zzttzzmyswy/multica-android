/**
 * Runtime detail usage section (iteration-93, MYS-676) — web
 * packages/views/runtimes/components/usage-section.tsx on a phone: per-runtime
 * 7/30-day KPI row (cost / tokens / cache savings) + daily cost bars fed by
 * GET /api/runtimes/:id/usage?days=&tz=. Cost math (estimateCost /
 * estimateCacheSavings) lives in lib/runtime-usage.ts, shared with web's rate
 * table so the numbers agree.
 *
 * Scope vs web: web adds a 90/180-day window with a weekly grain and the
 * "who spent it" by-agent breakdown — mobile keeps 7d/30d daily bars this
 * iteration (30d default matches web's), the by-agent tab stays a follow-up.
 */
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { runtimeUsageOptions } from "@/data/queries/runtimes";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { formatTokens } from "@/lib/usage-format";
import {
  aggregateRuntimeCostByDate,
  computeRuntimeTotals,
  formatUsd,
} from "@/lib/runtime-usage";

const RANGES = [7, 30] as const;
type Days = (typeof RANGES)[number];

const CHART_HEIGHT = 96;

function RANGE_LABEL(days: Days): string {
  return days === 7 ? "runtimes.usage.range7d" : "runtimes.usage.range30d";
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
        <Text
          className="mt-0.5 text-[10px] text-muted-foreground/70"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export function RuntimeUsageSection({ runtimeId }: { runtimeId: string }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const [days, setDays] = useState<Days>(30);
  // One report axis shared with the server: pass the viewer's IANA zone so
  // both sides slice daily buckets on the same calendar boundary (web
  // useViewingTimezone parity).
  const tz = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    [],
  );
  const { data = [], isLoading } = useQuery(runtimeUsageOptions(runtimeId, days, tz));

  const daily = useMemo(() => aggregateRuntimeCostByDate(data), [data]);
  const totals = useMemo(() => computeRuntimeTotals(data), [data]);

  const cacheable = totals.input + totals.cacheRead;
  const cacheHitRate =
    cacheable > 0 ? Math.round((totals.cacheRead / cacheable) * 100) : 0;

  return (
    <View className="mt-4 rounded-lg border border-border overflow-hidden">
      {/* Header: title + 7d/30d segmented switch */}
      <View className="flex-row items-center justify-between border-b border-border px-3 py-2">
        <View className="flex-row items-center gap-1.5">
          <Ionicons name="pulse-outline" size={14} color={theme.mutedForeground} />
          <Text className="text-xs font-semibold text-foreground">
            {t("runtimes.usage.title")}
          </Text>
        </View>
        <View className="flex-row rounded-md bg-secondary p-0.5">
          {RANGES.map((r) => (
            <Pressable
              key={r}
              onPress={() => setDays(r)}
              className={cn(
                "rounded px-2 py-0.5",
                r === days ? "bg-card shadow-sm" : "opacity-70",
              )}
            >
              <Text
                className={cn(
                  "text-xs font-medium",
                  r === days ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {t(RANGE_LABEL(r))}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {isLoading ? (
        <View className="items-center justify-center px-4 py-8">
          <ActivityIndicator />
        </View>
      ) : data.length === 0 ? (
        <View className="items-center gap-1.5 px-4 py-8">
          <Ionicons name="bar-chart-outline" size={20} color={theme.mutedForeground} />
          <Text className="text-xs text-muted-foreground">
            {t("runtimes.usage.empty")}
          </Text>
        </View>
      ) : (
        <View className="p-3 gap-3">
          {/* KPI row — cost / cache savings / tokens */}
          <View className="flex-row gap-2">
            <KpiCard
              icon="cash-outline"
              label={t("runtimes.usage.kpiCost")}
              value={formatUsd(totals.cost)}
            />
            <KpiCard
              icon="server-outline"
              label={t("runtimes.usage.kpiCache")}
              value={formatUsd(totals.cacheSavings)}
              hint={t("runtimes.usage.kpiCacheHint", {
                pct: cacheHitRate,
                reads: formatTokens(totals.cacheRead),
              })}
            />
            <KpiCard
              icon="flash-outline"
              label={t("runtimes.usage.kpiTokens")}
              value={formatTokens(
                totals.input + totals.output + totals.cacheRead + totals.cacheWrite,
              )}
              hint={t("runtimes.usage.kpiTokensHint", {
                input: formatTokens(totals.input),
                output: formatTokens(totals.output),
              })}
            />
          </View>

          {/* Daily cost bars — pure RN Views, no chart dependency */}
          <View>
            <View className="flex-row items-center justify-between mb-1.5">
              <Text className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {t("runtimes.usage.chartTitle")}
              </Text>
              <Text className="text-[10px] text-muted-foreground">
                {t("runtimes.usage.chartLegend")}
              </Text>
            </View>
            {daily.length === 0 ? (
              <Text className="py-4 text-center text-xs text-muted-foreground">
                {t("runtimes.usage.empty")}
              </Text>
            ) : (
              <DailyCostBars rows={daily} />
            )}
          </View>
        </View>
      )}
    </View>
  );
}

function DailyCostBars({ rows }: { rows: ReturnType<typeof aggregateRuntimeCostByDate> }) {
  const max = Math.max(...rows.map((r) => r.cost), 0);
  const labelEvery = rows.length > 8 ? 2 : 1;
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <View className="flex-row items-end gap-1.5" style={{ height: CHART_HEIGHT + 22 }}>
      {rows.map((d, i) => {
        const h = max > 0 ? Math.max((d.cost / max) * CHART_HEIGHT, 2) : 2;
        return (
          <View key={d.date} className="flex-1 items-center gap-1">
            <View
              style={{
                height: h,
                borderTopLeftRadius: 4,
                borderTopRightRadius: 4,
                backgroundColor: theme.brand,
                opacity: d.cost > 0 ? 0.85 : 0.15,
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