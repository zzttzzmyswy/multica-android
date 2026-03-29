"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Monitor,
  Cloud,
  Wifi,
  WifiOff,
  Server,
  BarChart3,
  Loader2,
  CheckCircle2,
  XCircle,
  Zap,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Label,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useDefaultLayout } from "react-resizable-panels";
import type { AgentRuntime, RuntimeUsage, RuntimeHourlyActivity, RuntimePingStatus } from "@/shared/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { api } from "@/shared/api";
import { useAuthStore } from "@/features/auth";
import { useWorkspaceStore } from "@/features/workspace";
import { useWSEvent } from "@/features/realtime";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatLastSeen(lastSeenAt: string | null): string {
  if (!lastSeenAt) return "Never";
  const diff = Date.now() - new Date(lastSeenAt).getTime();
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

// Pricing per million tokens (USD)
const MODEL_PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  "claude-sonnet-4-5": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-opus-4-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-6": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
};

function estimateCost(usage: RuntimeUsage): number {
  // Try to find a matching model in pricing table
  const model = usage.model;
  let pricing = MODEL_PRICING[model];
  if (!pricing) {
    // Try partial match
    for (const [key, p] of Object.entries(MODEL_PRICING)) {
      if (model.startsWith(key)) {
        pricing = p;
        break;
      }
    }
  }
  if (!pricing) return 0;

  return (
    (usage.input_tokens * pricing.input +
      usage.output_tokens * pricing.output +
      usage.cache_read_tokens * pricing.cacheRead +
      usage.cache_write_tokens * pricing.cacheWrite) /
    1_000_000
  );
}

function RuntimeModeIcon({ mode }: { mode: string }) {
  return mode === "cloud" ? (
    <Cloud className="h-3.5 w-3.5" />
  ) : (
    <Monitor className="h-3.5 w-3.5" />
  );
}

function StatusBadge({ status }: { status: string }) {
  const isOnline = status === "online";
  return (
    <Badge
      variant="secondary"
      className={
        isOnline
          ? "bg-success/10 text-success"
          : ""
      }
    >
      {isOnline ? (
        <Wifi className="h-3 w-3" />
      ) : (
        <WifiOff className="h-3 w-3" />
      )}
      {isOnline ? "Online" : "Offline"}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Runtime List Item
// ---------------------------------------------------------------------------

function RuntimeListItem({
  runtime,
  isSelected,
  onClick,
}: {
  runtime: AgentRuntime;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
        isSelected ? "bg-accent" : "hover:bg-accent/50"
      }`}
    >
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
          runtime.status === "online" ? "bg-success/10" : "bg-muted"
        }`}
      >
        <RuntimeModeIcon mode={runtime.runtime_mode} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{runtime.name}</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {runtime.provider} &middot; {runtime.runtime_mode}
        </div>
      </div>
      <div
        className={`h-2 w-2 shrink-0 rounded-full ${
          runtime.status === "online" ? "bg-success" : "bg-muted-foreground/40"
        }`}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Usage Section
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Chart configs
// ---------------------------------------------------------------------------

const tokenChartConfig = {
  input: { label: "Input", color: "hsl(var(--chart-1))" },
  output: { label: "Output", color: "hsl(var(--chart-2))" },
  cacheRead: { label: "Cache Read", color: "hsl(var(--chart-3))" },
  cacheWrite: { label: "Cache Write", color: "hsl(var(--chart-4))" },
} satisfies ChartConfig;

const costChartConfig = {
  cost: { label: "Cost", color: "hsl(var(--chart-1))" },
} satisfies ChartConfig;

const MODEL_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

// ---------------------------------------------------------------------------
// Data aggregation helpers
// ---------------------------------------------------------------------------

interface DailyTokenData {
  date: string;
  label: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

interface DailyCostData {
  date: string;
  label: string;
  cost: number;
}

interface ModelDistribution {
  model: string;
  tokens: number;
  cost: number;
}

function aggregateByDate(usage: RuntimeUsage[]): {
  dailyTokens: DailyTokenData[];
  dailyCost: DailyCostData[];
  modelDist: ModelDistribution[];
} {
  // Aggregate tokens by date
  const dateMap = new Map<string, Omit<DailyTokenData, "label">>();
  const costMap = new Map<string, number>();
  const modelMap = new Map<string, { tokens: number; cost: number }>();

  for (const u of usage) {
    const existing = dateMap.get(u.date) ?? {
      date: u.date,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    };
    existing.input += u.input_tokens;
    existing.output += u.output_tokens;
    existing.cacheRead += u.cache_read_tokens;
    existing.cacheWrite += u.cache_write_tokens;
    dateMap.set(u.date, existing);

    const dayCost = (costMap.get(u.date) ?? 0) + estimateCost(u);
    costMap.set(u.date, dayCost);

    const modelName = u.model || u.provider;
    const m = modelMap.get(modelName) ?? { tokens: 0, cost: 0 };
    m.tokens += u.input_tokens + u.output_tokens + u.cache_read_tokens + u.cache_write_tokens;
    m.cost += estimateCost(u);
    modelMap.set(modelName, m);
  }

  const formatLabel = (d: string) => {
    const date = new Date(d + "T00:00:00");
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  const dailyTokens = [...dateMap.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ ...d, label: formatLabel(d.date) }));

  const dailyCost = [...costMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, cost]) => ({ date, label: formatLabel(date), cost: Math.round(cost * 100) / 100 }));

  const modelDist = [...modelMap.entries()]
    .map(([model, data]) => ({ model, ...data }))
    .sort((a, b) => b.tokens - a.tokens);

  return { dailyTokens, dailyCost, modelDist };
}

// ---------------------------------------------------------------------------
// Chart Components
// ---------------------------------------------------------------------------

function DailyTokenChart({ data }: { data: DailyTokenData[] }) {
  return (
    <div className="rounded-lg border p-4">
      <h4 className="text-xs font-medium text-muted-foreground mb-3">Daily Token Usage</h4>
      <ChartContainer config={tokenChartConfig} className="aspect-[2.5/1] w-full">
        <AreaChart data={data} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            interval="preserveStartEnd"
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={(v: number) => formatTokens(v)}
            width={50}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value) =>
                  typeof value === "number" ? formatTokens(value) : String(value)
                }
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          <Area
            type="monotone"
            dataKey="input"
            stackId="1"
            stroke="var(--color-input)"
            fill="var(--color-input)"
            fillOpacity={0.4}
          />
          <Area
            type="monotone"
            dataKey="output"
            stackId="1"
            stroke="var(--color-output)"
            fill="var(--color-output)"
            fillOpacity={0.4}
          />
          <Area
            type="monotone"
            dataKey="cacheRead"
            stackId="1"
            stroke="var(--color-cacheRead)"
            fill="var(--color-cacheRead)"
            fillOpacity={0.4}
          />
          <Area
            type="monotone"
            dataKey="cacheWrite"
            stackId="1"
            stroke="var(--color-cacheWrite)"
            fill="var(--color-cacheWrite)"
            fillOpacity={0.4}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}

function DailyCostChart({ data }: { data: DailyCostData[] }) {
  if (data.every((d) => d.cost === 0)) return null;

  return (
    <div className="rounded-lg border p-4">
      <h4 className="text-xs font-medium text-muted-foreground mb-3">Daily Estimated Cost</h4>
      <ChartContainer config={costChartConfig} className="aspect-[2.5/1] w-full">
        <BarChart data={data} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            interval="preserveStartEnd"
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={(v: number) => `$${v}`}
            width={50}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value) =>
                  typeof value === "number" ? `$${value.toFixed(2)}` : String(value)
                }
              />
            }
          />
          <Bar dataKey="cost" fill="var(--color-cost)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ChartContainer>
    </div>
  );
}

function ModelDistributionChart({ data }: { data: ModelDistribution[] }) {
  if (data.length === 0) return null;

  const totalTokens = data.reduce((sum, d) => sum + d.tokens, 0);
  const chartConfig = Object.fromEntries(
    data.map((d, i) => [
      d.model,
      { label: d.model, color: MODEL_COLORS[i % MODEL_COLORS.length] },
    ]),
  ) satisfies ChartConfig;

  return (
    <div className="rounded-lg border p-4">
      <h4 className="text-xs font-medium text-muted-foreground mb-3">Token Usage by Model</h4>
      <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[200px]">
        <PieChart>
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value) =>
                  typeof value === "number" ? formatTokens(value) : String(value)
                }
                nameKey="model"
              />
            }
          />
          <Pie
            data={data}
            dataKey="tokens"
            nameKey="model"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={2}
          >
            {data.map((entry, i) => (
              <Cell
                key={entry.model}
                fill={MODEL_COLORS[i % MODEL_COLORS.length]}
              />
            ))}
            <Label
              content={({ viewBox }) => {
                if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                  return (
                    <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                      <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-lg font-bold">
                        {formatTokens(totalTokens)}
                      </tspan>
                      <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) + 18} className="fill-muted-foreground text-xs">
                        tokens
                      </tspan>
                    </text>
                  );
                }
                return null;
              }}
            />
          </Pie>
        </PieChart>
      </ChartContainer>
      {/* Model legend with cost */}
      <div className="mt-3 space-y-1.5">
        {data.map((d, i) => (
          <div key={d.model} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <div
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: MODEL_COLORS[i % MODEL_COLORS.length] }}
              />
              <span className="truncate font-mono">{d.model}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0 text-muted-foreground tabular-nums">
              <span>{formatTokens(d.tokens)}</span>
              {d.cost > 0 && <span>${d.cost.toFixed(2)}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity Heatmap (GitHub-style)
// ---------------------------------------------------------------------------

const HEATMAP_WEEKS = 13;
const CELL_SIZE = 11;
const CELL_GAP = 2;
const DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

function getHeatmapColor(level: number): string {
  // 5 levels: 0=empty, 1-4=increasing intensity
  const colors = [
    "var(--color-muted, hsl(var(--muted)))",
    "hsl(var(--chart-3) / 0.3)",
    "hsl(var(--chart-3) / 0.5)",
    "hsl(var(--chart-3) / 0.75)",
    "hsl(var(--chart-3) / 1)",
  ];
  return colors[level] ?? colors[0]!;
}

function ActivityHeatmap({ usage }: { usage: RuntimeUsage[] }) {
  const { cells, monthLabels } = useMemo(() => {
    // Build a map of date -> total tokens
    const dateTokens = new Map<string, number>();
    for (const u of usage) {
      const total = u.input_tokens + u.output_tokens + u.cache_read_tokens + u.cache_write_tokens;
      dateTokens.set(u.date, (dateTokens.get(u.date) ?? 0) + total);
    }

    // Generate all dates for the last HEATMAP_WEEKS weeks
    const today = new Date();
    const todayDay = today.getDay(); // 0=Sun
    // Start from the beginning of the week, HEATMAP_WEEKS weeks ago
    const startOffset = todayDay + (HEATMAP_WEEKS - 1) * 7;
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - startOffset);

    const allCells: { date: string; dayOfWeek: number; week: number; tokens: number }[] = [];
    const d = new Date(startDate);
    for (let i = 0; i <= startOffset; i++) {
      const dateStr = d.toISOString().slice(0, 10);
      const dayOfWeek = d.getDay(); // 0=Sun .. 6=Sat
      const week = Math.floor(i / 7);
      allCells.push({ date: dateStr, dayOfWeek, week, tokens: dateTokens.get(dateStr) ?? 0 });
      d.setDate(d.getDate() + 1);
    }

    // Compute intensity levels (quantiles)
    const nonZero = allCells.filter((c) => c.tokens > 0).map((c) => c.tokens);
    nonZero.sort((a, b) => a - b);
    const getLevel = (tokens: number) => {
      if (tokens === 0) return 0;
      if (nonZero.length <= 1) return 4;
      const p = nonZero.indexOf(tokens) / (nonZero.length - 1);
      if (p <= 0.25) return 1;
      if (p <= 0.5) return 2;
      if (p <= 0.75) return 3;
      return 4;
    };

    const cellsWithLevel = allCells.map((c) => ({ ...c, level: getLevel(c.tokens) }));

    // Month labels: find the first day of each month that appears
    const months: { label: string; week: number }[] = [];
    let lastMonth = -1;
    for (const c of cellsWithLevel) {
      const month = new Date(c.date + "T00:00:00").getMonth();
      if (month !== lastMonth && c.dayOfWeek === 0) {
        months.push({
          label: new Date(c.date + "T00:00:00").toLocaleString("en", { month: "short" }),
          week: c.week,
        });
        lastMonth = month;
      }
    }

    return { cells: cellsWithLevel, monthLabels: months };
  }, [usage]);

  const labelWidth = 28;
  const svgWidth = labelWidth + HEATMAP_WEEKS * (CELL_SIZE + CELL_GAP);
  const svgHeight = 14 + 7 * (CELL_SIZE + CELL_GAP);

  return (
    <div className="rounded-lg border p-4">
      <h4 className="text-xs font-medium text-muted-foreground mb-3">Activity</h4>
      <div className="overflow-x-auto">
        <svg width={svgWidth} height={svgHeight} className="block">
          {/* Month labels */}
          {monthLabels.map((m) => (
            <text
              key={`${m.label}-${m.week}`}
              x={labelWidth + m.week * (CELL_SIZE + CELL_GAP)}
              y={10}
              className="fill-muted-foreground"
              fontSize={9}
            >
              {m.label}
            </text>
          ))}
          {/* Day labels */}
          {DAY_LABELS.map((label, i) =>
            label ? (
              <text
                key={i}
                x={0}
                y={14 + i * (CELL_SIZE + CELL_GAP) + CELL_SIZE - 1}
                className="fill-muted-foreground"
                fontSize={9}
              >
                {label}
              </text>
            ) : null,
          )}
          {/* Cells */}
          {cells.map((c) => (
            <rect
              key={c.date}
              x={labelWidth + c.week * (CELL_SIZE + CELL_GAP)}
              y={14 + c.dayOfWeek * (CELL_SIZE + CELL_GAP)}
              width={CELL_SIZE}
              height={CELL_SIZE}
              rx={2}
              fill={getHeatmapColor(c.level)}
              className="transition-colors"
            >
              <title>
                {c.date}: {c.tokens > 0 ? formatTokens(c.tokens) + " tokens" : "No activity"}
              </title>
            </rect>
          ))}
        </svg>
      </div>
      {/* Legend */}
      <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <div
            key={level}
            className="h-[10px] w-[10px] rounded-[2px]"
            style={{ backgroundColor: getHeatmapColor(level) }}
          />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hourly Activity Distribution
// ---------------------------------------------------------------------------

const hourlyChartConfig = {
  count: { label: "Tasks", color: "hsl(var(--chart-2))" },
} satisfies ChartConfig;

function HourlyActivityChart({ runtimeId }: { runtimeId: string }) {
  const [data, setData] = useState<RuntimeHourlyActivity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .getRuntimeTaskActivity(runtimeId)
      .then(setData)
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [runtimeId]);

  // Fill all 24 hours
  const chartData = useMemo(() => {
    const map = new Map(data.map((d) => [d.hour, d.count]));
    return Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      label: `${i.toString().padStart(2, "0")}:00`,
      count: map.get(i) ?? 0,
    }));
  }, [data]);

  const hasData = chartData.some((d) => d.count > 0);

  return (
    <div className="rounded-lg border p-4">
      <h4 className="text-xs font-medium text-muted-foreground mb-3">Hourly Distribution</h4>
      {loading ? (
        <div className="flex h-[140px] items-center justify-center text-xs text-muted-foreground">
          Loading...
        </div>
      ) : !hasData ? (
        <div className="flex h-[140px] flex-col items-center justify-center">
          <BarChart3 className="h-5 w-5 text-muted-foreground/40" />
          <p className="mt-2 text-xs text-muted-foreground">No task data yet</p>
        </div>
      ) : (
        <ChartContainer config={hourlyChartConfig} className="aspect-[2.5/1] w-full">
          <BarChart data={chartData} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              interval={2}
              fontSize={10}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={30}
              allowDecimals={false}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="count" fill="var(--color-count)" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ChartContainer>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Usage Section
// ---------------------------------------------------------------------------

function UsageSection({ runtimeId }: { runtimeId: string }) {
  const [usage, setUsage] = useState<RuntimeUsage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .getRuntimeUsage(runtimeId, { days: 90 })
      .then(setUsage)
      .catch(() => setUsage([]))
      .finally(() => setLoading(false));
  }, [runtimeId]);

  if (loading) {
    return (
      <div className="text-xs text-muted-foreground">Loading usage...</div>
    );
  }

  if (usage.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-lg border border-dashed py-6">
        <BarChart3 className="h-5 w-5 text-muted-foreground/40" />
        <p className="mt-2 text-xs text-muted-foreground">
          No usage data yet
        </p>
      </div>
    );
  }

  // Filter last 30 days for summary / detail charts
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const cutoff = thirtyDaysAgo.toISOString().slice(0, 10);
  const recent = usage.filter((u) => u.date >= cutoff);

  // Compute totals (30d)
  const totals = recent.reduce(
    (acc, u) => ({
      input: acc.input + u.input_tokens,
      output: acc.output + u.output_tokens,
      cacheRead: acc.cacheRead + u.cache_read_tokens,
      cacheWrite: acc.cacheWrite + u.cache_write_tokens,
      cost: acc.cost + estimateCost(u),
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
  );

  const { dailyTokens, dailyCost, modelDist } = aggregateByDate(recent);

  // Group by date for the table
  const byDate = new Map<string, RuntimeUsage[]>();
  for (const u of recent) {
    const existing = byDate.get(u.date) ?? [];
    existing.push(u);
    byDate.set(u.date, existing);
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        <TokenCard label="Input" value={totals.input} />
        <TokenCard label="Output" value={totals.output} />
        <TokenCard label="Cache Read" value={totals.cacheRead} />
        <TokenCard label="Cache Write" value={totals.cacheWrite} />
      </div>

      {totals.cost > 0 && (
        <div className="rounded-lg border bg-muted/30 px-3 py-2">
          <span className="text-xs text-muted-foreground">
            Estimated cost (30d):{" "}
          </span>
          <span className="text-sm font-semibold">
            ${totals.cost.toFixed(2)}
          </span>
        </div>
      )}

      {/* Heatmap + Hourly — 2-col on wide screens */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ActivityHeatmap usage={usage} />
        <HourlyActivityChart runtimeId={runtimeId} />
      </div>

      {/* Token & Cost charts — 2-col on wide screens */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <DailyTokenChart data={dailyTokens} />
        <DailyCostChart data={dailyCost} />
      </div>

      <ModelDistributionChart data={modelDist} />

      {/* Daily breakdown table */}
      <div className="rounded-lg border">
        <div className="grid grid-cols-[100px_1fr_80px_80px_80px_80px] gap-2 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
          <div>Date</div>
          <div>Model</div>
          <div className="text-right">Input</div>
          <div className="text-right">Output</div>
          <div className="text-right">Cache R</div>
          <div className="text-right">Cache W</div>
        </div>
        <div className="max-h-64 overflow-y-auto divide-y">
          {[...byDate.entries()].map(([date, rows]) =>
            rows.map((row, i) => (
              <div
                key={`${date}-${row.model}-${i}`}
                className="grid grid-cols-[100px_1fr_80px_80px_80px_80px] gap-2 px-3 py-1.5 text-xs"
              >
                <div className="text-muted-foreground">{date}</div>
                <div className="truncate font-mono">{row.model}</div>
                <div className="text-right tabular-nums">
                  {formatTokens(row.input_tokens)}
                </div>
                <div className="text-right tabular-nums">
                  {formatTokens(row.output_tokens)}
                </div>
                <div className="text-right tabular-nums">
                  {formatTokens(row.cache_read_tokens)}
                </div>
                <div className="text-right tabular-nums">
                  {formatTokens(row.cache_write_tokens)}
                </div>
              </div>
            )),
          )}
        </div>
      </div>
    </div>
  );
}

function TokenCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">
        {formatTokens(value)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connection Test (Ping)
// ---------------------------------------------------------------------------

const pingStatusConfig: Record<
  RuntimePingStatus,
  { label: string; icon: typeof Loader2; color: string }
> = {
  pending: { label: "Waiting for daemon...", icon: Loader2, color: "text-muted-foreground" },
  running: { label: "Running test...", icon: Loader2, color: "text-info" },
  completed: { label: "Connected", icon: CheckCircle2, color: "text-success" },
  failed: { label: "Failed", icon: XCircle, color: "text-destructive" },
  timeout: { label: "Timeout", icon: XCircle, color: "text-warning" },
};

function PingSection({ runtimeId }: { runtimeId: string }) {
  const [status, setStatus] = useState<RuntimePingStatus | null>(null);
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [testing, setTesting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const handleTest = async () => {
    cleanup();
    setTesting(true);
    setStatus("pending");
    setOutput("");
    setError("");
    setDurationMs(null);

    try {
      const ping = await api.pingRuntime(runtimeId);

      // Poll for result every 2 seconds
      pollRef.current = setInterval(async () => {
        try {
          const result = await api.getPingResult(runtimeId, ping.id);
          setStatus(result.status as RuntimePingStatus);

          if (result.status === "completed") {
            setOutput(result.output ?? "");
            setDurationMs(result.duration_ms ?? null);
            setTesting(false);
            cleanup();
          } else if (result.status === "failed" || result.status === "timeout") {
            setError(result.error ?? "Unknown error");
            setDurationMs(result.duration_ms ?? null);
            setTesting(false);
            cleanup();
          }
        } catch {
          // ignore poll errors
        }
      }, 2000);
    } catch {
      setStatus("failed");
      setError("Failed to initiate test");
      setTesting(false);
    }
  };

  const config = status ? pingStatusConfig[status] : null;
  const Icon = config?.icon;
  const isActive = status === "pending" || status === "running";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="xs"
          onClick={handleTest}
          disabled={testing}
        >
          {testing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Zap className="h-3 w-3" />
          )}
          {testing ? "Testing..." : "Test Connection"}
        </Button>

        {config && Icon && (
          <span className={`inline-flex items-center gap-1 text-xs ${config.color}`}>
            <Icon className={`h-3 w-3 ${isActive ? "animate-spin" : ""}`} />
            {config.label}
            {durationMs != null && (
              <span className="text-muted-foreground">
                ({(durationMs / 1000).toFixed(1)}s)
              </span>
            )}
          </span>
        )}
      </div>

      {status === "completed" && output && (
        <div className="rounded-lg border bg-success/5 px-3 py-2">
          <pre className="text-xs font-mono whitespace-pre-wrap">{output}</pre>
        </div>
      )}

      {(status === "failed" || status === "timeout") && error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2">
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Runtime Detail
// ---------------------------------------------------------------------------

function RuntimeDetail({ runtime }: { runtime: AgentRuntime }) {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <div className="flex min-w-0 items-center gap-2">
          <div
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
              runtime.status === "online" ? "bg-success/10" : "bg-muted"
            }`}
          >
            <RuntimeModeIcon mode={runtime.runtime_mode} />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold truncate">{runtime.name}</h2>
          </div>
        </div>
        <StatusBadge status={runtime.status} />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Info grid */}
        <div className="grid grid-cols-2 gap-4">
          <InfoField label="Runtime Mode" value={runtime.runtime_mode} />
          <InfoField label="Provider" value={runtime.provider} />
          <InfoField label="Status" value={runtime.status} />
          <InfoField
            label="Last Seen"
            value={formatLastSeen(runtime.last_seen_at)}
          />
          {runtime.device_info && (
            <InfoField label="Device" value={runtime.device_info} />
          )}
          {runtime.daemon_id && (
            <InfoField label="Daemon ID" value={runtime.daemon_id} mono />
          )}
        </div>

        {/* Connection Test */}
        <div>
          <h3 className="text-xs font-medium text-muted-foreground mb-3">
            Connection Test
          </h3>
          <PingSection runtimeId={runtime.id} />
        </div>

        {/* Usage */}
        <div>
          <h3 className="text-xs font-medium text-muted-foreground mb-3">
            Token Usage (Last 30 Days)
          </h3>
          <UsageSection runtimeId={runtime.id} />
        </div>

        {/* Metadata */}
        {runtime.metadata && Object.keys(runtime.metadata).length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-muted-foreground mb-2">
              Metadata
            </h3>
            <div className="rounded-lg border bg-muted/30 p-3">
              <pre className="text-xs font-mono whitespace-pre-wrap break-all">
                {JSON.stringify(runtime.metadata, null, 2)}
              </pre>
            </div>
          </div>
        )}

        {/* Timestamps */}
        <div className="grid grid-cols-2 gap-4 border-t pt-4">
          <InfoField
            label="Created"
            value={new Date(runtime.created_at).toLocaleString()}
          />
          <InfoField
            label="Updated"
            value={new Date(runtime.updated_at).toLocaleString()}
          />
        </div>
      </div>
    </div>
  );
}

function InfoField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`mt-0.5 text-sm truncate ${mono ? "font-mono text-xs" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RuntimesPage() {
  const isLoading = useAuthStore((s) => s.isLoading);
  const workspace = useWorkspaceStore((s) => s.workspace);
  const [runtimes, setRuntimes] = useState<AgentRuntime[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [fetching, setFetching] = useState(true);
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "multica_runtimes_layout",
  });

  const fetchRuntimes = useCallback(async () => {
    if (!workspace) return;
    try {
      const data = await api.listRuntimes({ workspace_id: workspace.id });
      setRuntimes(data);
    } finally {
      setFetching(false);
    }
  }, [workspace]);

  useEffect(() => {
    fetchRuntimes();
  }, [fetchRuntimes]);

  // Auto-select first runtime
  useEffect(() => {
    if (runtimes.length > 0 && !selectedId) {
      setSelectedId(runtimes[0]!.id);
    }
  }, [runtimes, selectedId]);

  // Real-time updates
  const handleDaemonEvent = useCallback(() => {
    fetchRuntimes();
  }, [fetchRuntimes]);

  useWSEvent("daemon:register", handleDaemonEvent);
  useWSEvent("daemon:heartbeat", handleDaemonEvent);

  const selected = runtimes.find((r) => r.id === selectedId) ?? null;

  if (isLoading || fetching) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="flex-1 min-h-0"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      <ResizablePanel id="list" defaultSize={280} minSize={240} maxSize={400} groupResizeBehavior="preserve-pixel-size">
        {/* Left column — runtime list */}
        <div className="overflow-y-auto h-full border-r">
          <div className="flex h-12 items-center justify-between border-b px-4">
            <h1 className="text-sm font-semibold">Runtimes</h1>
            <span className="text-xs text-muted-foreground">
              {runtimes.filter((r) => r.status === "online").length}/
              {runtimes.length} online
            </span>
          </div>
          {runtimes.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-4 py-12">
              <Server className="h-8 w-8 text-muted-foreground/40" />
              <p className="mt-3 text-sm text-muted-foreground">
                No runtimes registered
              </p>
              <p className="mt-1 text-xs text-muted-foreground text-center">
                Run{" "}
                <code className="rounded bg-muted px-1 py-0.5">
                  multica daemon start
                </code>{" "}
                to register a local runtime.
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {runtimes.map((runtime) => (
                <RuntimeListItem
                  key={runtime.id}
                  runtime={runtime}
                  isSelected={runtime.id === selectedId}
                  onClick={() => setSelectedId(runtime.id)}
                />
              ))}
            </div>
          )}
        </div>
      </ResizablePanel>

      <ResizableHandle />

      <ResizablePanel id="detail" minSize="50%">
        {/* Right column — runtime detail */}
        {selected ? (
          <RuntimeDetail key={selected.id} runtime={selected} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
            <Server className="h-10 w-10 text-muted-foreground/30" />
            <p className="mt-3 text-sm">Select a runtime to view details</p>
          </div>
        )}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
