/**
 * Per-run usage breakdown for one issue — the surface the runs sheet's
 * header total chip (`UsageTotalChip`) opens. Web parity:
 * packages/views/issues/components/issue-usage-dialog.tsx.
 *
 * Web renders a 9-column table inside a centered dialog; a phone cannot hold
 * that, so each run is one CARD carrying the same figures — model / duration
 * / in / out / cache-read / cache-write / tokens / cost — with a max-relative
 * token bar, web's `tfoot` total row, the optional cost-by-agent bars, and
 * the same footnotes. Every figure comes from the same `summarizeTaskUsage`
 * helpers the header chip uses, so the total here can never disagree with
 * the total that opened it.
 *
 * Deliberate deviations, each noted at its site:
 *  - rendered as a bottom-sheet Modal rather than a centered dialog: the runs
 *    sheet is itself a formSheet route, and a second sheet layered over it
 *    keeps the "drill into the total" model without fighting the phone's
 *    safe areas; the inner content still mirrors web's structure
 *  - the token bar is one thin track per card instead of web's bar-in-table
 *    cell — same max-relative metric, readable at card width
 *  - no custom-pricing store (see lib/task-usage.ts header note), so the
 *    pricing snapshot subscription web needs for live re-price is a no-op here
 */
import { useMemo } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { AgentTask } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { useActorLookup } from "@/data/use-actor-name";
import { useTranslation } from "@/lib/i18n/react";
import { formatTokens } from "@/lib/usage-format";
import { formatDuration } from "@/lib/usage-time";
import {
  collectUnmappedModels,
  formatUsd,
  summarizeTaskUsage,
  summarizeTaskUsageAcross,
  type TaskUsageSummary,
} from "@/lib/task-usage";

const tKey = "runs.usageDetail";

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Issue identifier ("MYS-568"); empty when the detail query hasn't landed. */
  identifier: string;
  tasks: AgentTask[];
}

export function UsageBreakdownDialog({
  visible,
  onClose,
  identifier,
  tasks,
}: Props) {
  const { t } = useTranslation();

  // Only runs that actually recorded usage earn a card: a run with no figure
  // contributes nothing to compare and would just add an all-em-dash line.
  // Their existence is still accounted for in the footnote below.
  const priced = useMemo(
    () => tasks.filter((task) => (task.usage?.length ?? 0) > 0),
    [tasks],
  );
  const unpricedCount = tasks.length - priced.length;

  const total = useMemo(
    () => summarizeTaskUsageAcross(priced.map((task) => task.usage)),
    [priced],
  );

  // Models with no rate-table entry and no provider-reported cost: their
  // tokens are counted but their spend is not, so the totals understate
  // reality. Saying so is the difference between an estimate and a wrong
  // number (web collectUnmappedModels, same semantics).
  const unmapped = useMemo(
    () => collectUnmappedModels(priced.flatMap((task) => task.usage ?? [])),
    [priced],
  );

  const agentIds = useMemo(
    () => Array.from(new Set(priced.map((task) => task.agent_id).filter(Boolean))),
    [priced],
  );

  // Floor, not round: on a cache-heavy issue 99.55% rounds to "100% hit
  // rate", which claims every token came from cache. Flooring only ever says
  // 100% when it is actually 100% (web parity).
  const cacheHitRate =
    total && total.input + total.cacheRead > 0
      ? Math.floor((total.cacheRead / (total.input + total.cacheRead)) * 100)
      : 0;

  const runCount = priced.length;
  const subtitle = t(
    runCount === 1 ? `${tKey}.subtitleOne` : `${tKey}.subtitle`,
    { label: identifier ? `${identifier} · ${runCount}` : `${runCount}` },
  );

  // Token bars are max-relative against the other priced runs (web RunTable
  // computes the same max), so the parent derives it once.
  const maxTokens = useMemo(
    () =>
      priced.reduce(
        (m, task) => Math.max(m, summarizeTaskUsage(task.usage)?.tokens ?? 0),
        0,
      ),
    [priced],
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end bg-black/40">
        <Pressable className="absolute inset-0" onPress={onClose} />
        <View className="max-h-[88%] rounded-t-2xl bg-popover">
          <View className="items-center pt-2 pb-1">
            <View className="h-1 w-10 rounded-full bg-muted" />
          </View>
          <View className="flex-row items-center gap-2 px-4 pb-3">
            <View className="flex-1 min-w-0">
              <Text className="text-base font-semibold text-foreground">
                {t(`${tKey}.title`)}
              </Text>
              <Text className="mt-0.5 text-xs text-muted-foreground">
                {subtitle}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t("a11y.close")}
              className="p-1"
            >
              <Ionicons name="close" size={20} color="#71717a" />
            </Pressable>
          </View>

          {total == null ? (
            <View className="px-4 pb-8 pt-6">
              <Text className="text-center text-sm text-muted-foreground">
                {t(`${tKey}.empty`)}
              </Text>
            </View>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerClassName="px-4 pb-6 gap-4"
            >
              {/* KPI row — web's grid-cols-3, three cards across. */}
              <View className="flex-row gap-2">
                <KpiCard
                  label={t(`${tKey}.kpiCost`)}
                  value={formatUsd(total.cost)}
                  hint={<CostFailHint tasks={priced} total={total} />}
                />
                <KpiCard
                  label={t(`${tKey}.kpiCache`)}
                  value={formatUsd(total.cacheSavings)}
                  accent={total.cacheSavings > 0}
                  hint={t(`${tKey}.kpiCacheHint`, {
                    pct: cacheHitRate,
                    reads: formatTokens(total.cacheRead),
                  })}
                />
                <KpiCard
                  label={t(`${tKey}.kpiTokens`)}
                  value={formatTokens(total.tokens)}
                  hint={t(`${tKey}.kpiTokensHint`, {
                    input: formatTokens(total.input),
                    output: formatTokens(total.output),
                  })}
                />
              </View>

              {agentIds.length > 1 ? (
                <CostByAgent tasks={priced} agentIds={agentIds} />
              ) : null}

              <View className="gap-2">
                {priced.map((task) => (
                  <RunUsageCard
                    key={task.id}
                    task={task}
                    maxTokens={maxTokens}
                  />
                ))}
              </View>

              <TotalRow total={total} />

              <View className="gap-1 px-1">
                {unpricedCount > 0 && (
                  <Text className="text-[11px] leading-4 text-muted-foreground">
                    {t(
                      unpricedCount === 1
                        ? `${tKey}.noteUnpricedOne`
                        : `${tKey}.noteUnpriced`,
                      { count: unpricedCount },
                    )}
                  </Text>
                )}
                {unmapped.length > 0 && (
                  <Text className="text-[11px] leading-4 text-muted-foreground">
                    {t(`${tKey}.noteUnmapped`, {
                      models: unmapped.join(", "),
                    })}
                  </Text>
                )}
                <Text className="text-[11px] leading-4 text-muted-foreground">
                  {t(`${tKey}.noteEstimate`)}
                </Text>
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

// One KPI tile. `hint` may be a localized string or the failed-run warning
// node (only rendered when there IS a failed run with a cost, so a healthy
// issue gets no scolding hint — web CostConcentrationHint).
function KpiCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <View className="min-w-0 flex-1 items-center gap-0.5 rounded-lg border border-border bg-card px-1 py-2">
      <Text className="text-[10px] text-muted-foreground" numberOfLines={1}>
        {label}
      </Text>
      <Text
        className={`text-sm font-bold tabular-nums ${
          accent ? "text-success" : "text-foreground"
        }`}
        numberOfLines={1}
      >
        {value}
      </Text>
      <View className="min-h-[14px] items-center px-0.5">
        <Text className="text-center text-[9px] leading-[14px] text-muted-foreground">
          {hint ?? ""}
        </Text>
      </View>
    </View>
  );
}

// "N failed runs account for X%" — the most useful thing the total can say
// about itself, and the reason this dialog exists. Warning-colored and only
// shown when there IS a failed run with a cost (web CostConcentrationHint).
function CostFailHint({
  tasks,
  total,
}: {
  tasks: AgentTask[];
  total: TaskUsageSummary;
}) {
  const { t } = useTranslation();
  const failed = tasks.filter((task) => task.status === "failed");
  if (failed.length === 0 || total.cost <= 0) return null;

  const failedCost = failed.reduce(
    (sum, task) => sum + (summarizeTaskUsage(task.usage)?.cost ?? 0),
    0,
  );
  if (failedCost <= 0) return null;

  return (
    <Text className="text-warning">
      {t(
        failed.length === 1 ? `${tKey}.costFailHintOne` : `${tKey}.costFailHint`,
        { count: failed.length, pct: Math.round((failedCost / total.cost) * 100) },
      )}
    </Text>
  );
}

// Same bar language as web's CostByAgent: one row per agent, bar scaled to
// the biggest spender. Hidden for a single-agent issue, where a one-bar
// chart says nothing the total didn't.
function CostByAgent({
  tasks,
  agentIds,
}: {
  tasks: AgentTask[];
  agentIds: string[];
}) {
  const { t } = useTranslation();
  const { getName } = useActorLookup();

  const rows = useMemo(() => {
    return agentIds
      .map((agentId) => {
        const own = tasks.filter((task) => task.agent_id === agentId);
        const summary = summarizeTaskUsageAcross(own.map((task) => task.usage));
        return { agentId, cost: summary?.cost ?? 0, tokens: summary?.tokens ?? 0 };
      })
      .sort((a, b) => b.cost - a.cost);
  }, [agentIds, tasks]);

  const maxCost = rows.reduce((m, r) => Math.max(m, r.cost), 0);

  return (
    <View className="gap-1.5">
      <Text className="text-xs font-medium text-foreground">
        {t(`${tKey}.byAgent`)}
      </Text>
      {rows.map((row) => (
        <View key={row.agentId} className="flex-row items-center gap-2">
          <Text numberOfLines={1} className="w-24 text-xs text-foreground">
            {getName("agent", row.agentId)}
          </Text>
          <View className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <View
              className="h-full rounded-full bg-brand"
              style={{ width: `${maxCost > 0 ? (row.cost / maxCost) * 100 : 0}%` }}
            />
          </View>
          <Text className="w-16 text-right text-xs tabular-nums text-muted-foreground">
            {formatTokens(row.tokens)}
          </Text>
          <Text className="w-14 text-right text-xs font-medium tabular-nums text-foreground">
            {formatUsd(row.cost)}
          </Text>
        </View>
      ))}
    </View>
  );
}

// One run = one card. Same fields as web's RunRow, but a vertical card
// because nine columns cannot fit a phone. Runs with no usage never reach
// here (filtered by the parent).
function RunUsageCard({ task, maxTokens }: { task: AgentTask; maxTokens: number }) {
  const { t } = useTranslation();
  const { getName } = useActorLookup();
  const summary = useMemo(() => summarizeTaskUsage(task.usage), [task.usage]);
  const trigger = task.trigger_summary?.trim() || fallbackTrigger(task, t);
  const duration =
    task.started_at && task.completed_at
      ? formatDuration(
          (new Date(task.completed_at).getTime() -
            new Date(task.started_at).getTime()) /
            1000,
          t("usage.lessThanMinute"),
        )
      : "";

  if (!summary) return null;

  return (
    <View className="gap-2 rounded-lg border border-border bg-card p-3">
      <View className="flex-row items-center gap-1.5">
        <ActorAvatar type="agent" id={task.agent_id} size={18} />
        <Text
          numberOfLines={1}
          className="flex-1 min-w-0 text-[13px] font-medium text-foreground"
        >
          {getName("agent", task.agent_id)}
          {trigger ? ` · ${trigger}` : ""}
        </Text>
        {duration ? (
          <Text className="text-[11px] tabular-nums text-muted-foreground">
            {duration}
          </Text>
        ) : null}
        <StatusGlyph task={task} />
      </View>

      {summary.models.length > 0 ? (
        <Text
          numberOfLines={1}
          className="text-[11px] text-muted-foreground"
        >
          {summary.models.join(", ")}
        </Text>
      ) : null}

      <View className="flex-row justify-between">
        <Stat label={t(`${tKey}.colInput`)} value={formatTokens(summary.input)} />
        <Stat label={t(`${tKey}.colOutput`)} value={formatTokens(summary.output)} />
        <Stat
          label={t(`${tKey}.colCacheRead`)}
          value={formatTokens(summary.cacheRead)}
        />
        <Stat
          label={t(`${tKey}.colCacheWrite`)}
          value={formatTokens(summary.cacheWrite)}
        />
      </View>

      <View className="flex-row items-center gap-2">
        <View className="flex-1 flex-row items-center gap-2 min-w-0">
          <Text className="text-xs tabular-nums text-foreground">
            {formatTokens(summary.tokens)}
          </Text>
          <View className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <View
              className="h-full rounded-full bg-brand"
              style={{
                width: `${
                  maxTokens > 0 ? (summary.tokens / maxTokens) * 100 : 0
                }%`,
              }}
            />
          </View>
        </View>
        <Text className="text-[13px] font-semibold tabular-nums text-foreground">
          {formatUsd(summary.cost)}
        </Text>
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="min-w-0 items-start">
      <Text className="text-[9px] uppercase text-muted-foreground">{label}</Text>
      <Text className="text-xs tabular-nums text-foreground">{value}</Text>
    </View>
  );
}

// Web's `tfoot` total row — same six figures, one band under the cards. The
// sum comes from the same summarizeTaskUsageAcross source as the KPI row.
function TotalRow({ total }: { total: TaskUsageSummary }) {
  const { t } = useTranslation();
  return (
    <View className="flex-row items-center justify-between rounded-lg bg-secondary px-3 py-2">
      <Text className="text-xs font-medium text-foreground">
        {t(`${tKey}.total`)}
      </Text>
      <View className="min-w-0 flex-1 items-end gap-0.5">
        <Text className="text-xs font-medium tabular-nums text-foreground">
          {formatTokens(total.tokens)} · {formatUsd(total.cost)}
        </Text>
        <Text
          numberOfLines={1}
          className="text-[10px] tabular-nums text-muted-foreground"
        >
          {t(`${tKey}.colInput`)} {formatTokens(total.input)} ·{" "}
          {t(`${tKey}.colOutput`)} {formatTokens(total.output)} ·{" "}
          {t(`${tKey}.colCacheRead`)} {formatTokens(total.cacheRead)} ·{" "}
          {t(`${tKey}.colCacheWrite`)} {formatTokens(total.cacheWrite)}
        </Text>
      </View>
    </View>
  );
}

// Terminal-status glyph, mirroring web TaskStatusIcon: a failed run carries
// the same mark wherever it is listed. Running renders a live label instead
// (web renders a pulse + status word for non-terminal rows); queued/
// dispatched/waiting render nothing.
function StatusGlyph({ task }: { task: AgentTask }) {
  const { t } = useTranslation();
  switch (task.status) {
    case "completed":
      return <Ionicons name="checkmark-circle" size={14} color="#22c55e" />;
    case "failed":
      return <Ionicons name="close-circle" size={14} color="#dc2626" />;
    case "cancelled":
      return <Ionicons name="ban" size={14} color="#71717a" />;
    case "running":
      return (
        <Text className="text-[10px] text-brand">
          {t("enum.taskStatus.running")}
        </Text>
      );
    default:
      return null;
  }
}

function fallbackTrigger(task: AgentTask, t: (id: string) => string): string {
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
