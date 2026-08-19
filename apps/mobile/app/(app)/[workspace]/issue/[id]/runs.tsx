/**
 * Agent Runs sheet — presented as a formSheet by the parent Stack. Two
 * sections: Active (queued/dispatched/running, created_at desc) and Past
 * (completed_at desc, status rank as tiebreaker). Empty
 * sections hide entirely.
 *
 * Both entry points (the in-card AgentActivityRow and the Stack-header
 * AgentHeaderBadge) now `router.push("/[workspace]/issue/[id]/runs")` —
 * the legacy `useRunsSheetStore` is gone since the route system is the
 * single source of truth for what's open.
 *
 * Rows are collapsible in both sections: past (terminal) runs expand to an
 * inline execution-log panel (`RunLog`), and active runs expand to the same
 * panel in `live` mode — a short poll keeps the still-growing trace
 * refreshing, so a running agent's work-in-progress is inspectable just like
 * web's live transcript.
 */
import { useMemo } from "react";
import { ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { AgentTask } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { RunRow } from "@/components/issue/run-row";
import {
  issueActiveTasksOptions,
  issueTasksOptions,
} from "@/data/queries/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { formatTokens } from "@/lib/usage-format";
import {
  formatUsd,
  summarizeTaskUsageAcross,
  type TaskUsageSummary,
} from "@/lib/task-usage";

const PAST_STATUS_ORDER: Record<AgentTask["status"], number> = {
  failed: 0,
  cancelled: 1,
  completed: 2,
  queued: 99,
  dispatched: 99,
  waiting_local_directory: 99,
  running: 99,
};

export default function IssueRunsRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  const { data: activeTasks = [] } = useQuery(
    issueActiveTasksOptions(wsId, id),
  );
  const { data: allTasks = [] } = useQuery(issueTasksOptions(wsId, id));

  const active = useMemo(
    () =>
      [...activeTasks].sort((a, b) =>
        (b.created_at ?? "").localeCompare(a.created_at ?? ""),
      ),
    [activeTasks],
  );

  const past = useMemo(() => {
    const filtered = allTasks.filter(
      (t) =>
        t.status === "completed" ||
        t.status === "failed" ||
        t.status === "cancelled",
    );
    return filtered.sort((a, b) => {
      const timeDiff = (b.completed_at ?? "").localeCompare(a.completed_at ?? "");
      if (timeDiff !== 0) return timeDiff;
      return PAST_STATUS_ORDER[a.status] - PAST_STATUS_ORDER[b.status];
    });
  }, [allTasks]);

  // Issue-level usage total, mirroring web's IssueUsageTotal on the
  // execution-log header (execution-log-section.tsx): null when NO run has
  // recorded usage → header chip hides entirely.
  const usageTotal = useMemo(
    () => summarizeTaskUsageAcross(allTasks.map((task) => task.usage)),
    [allTasks],
  );

  return (
    <View className="flex-1">
      <View className="px-4 pt-4 pb-3">
        <View className="flex-row items-center justify-between gap-2">
          <Text className="flex-1 text-base font-semibold text-foreground">
            {t("runs.agentRuns")}
          </Text>
          {usageTotal ? <UsageTotalChip total={usageTotal} /> : null}
        </View>
      </View>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View className="px-4 gap-3 pb-4">
          {active.length > 0 ? (
            <Section title={t("runs.active")}>
              {active.map((task) => (
                <RunRow key={task.id} task={task} issueId={id} />
              ))}
            </Section>
          ) : null}
          {past.length > 0 ? (
            <Section title={t("runs.past")}>
              {past.map((task) => (
                <RunRow key={task.id} task={task} issueId={id} />
              ))}
            </Section>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-1">
      <Text className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
        {title}
      </Text>
      <View>{children}</View>
    </View>
  );
}

/**
 * Issue-level tokens + estimated cost chip, styled like web's IssueUsageTotal
 * (`formatTokens · formatUsd`, cost in muted tone, tabular numerals). Renders
 * nothing when every run lacks usage — a chip claiming "0 tokens · $0.00"
 * would be a lie. Tap-to-open per-run breakdown is a later item.
 */
function UsageTotalChip({ total }: { total: TaskUsageSummary }) {
  const { t } = useTranslation();
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={t("runs.usageTotal")}
      className="flex-row items-center gap-1 rounded-md bg-secondary px-2 py-1"
    >
      <Text className="text-xs font-medium text-foreground tabular-nums">
        {formatTokens(total.tokens)}
      </Text>
      <Text className="text-xs text-muted-foreground">·</Text>
      <Text className="text-xs text-muted-foreground tabular-nums">
        {formatUsd(total.cost)}
      </Text>
    </View>
  );
}
