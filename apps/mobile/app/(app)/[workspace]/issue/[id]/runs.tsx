/**
 * Agent Runs sheet — presented as a formSheet by the parent Stack. The issue's
 * spend strip and (behind a tap) its run timeline, then Active
 * (queued/dispatched/running, created_at desc) and Past (completed_at desc,
 * status rank as tiebreaker). Empty sections hide entirely.
 *
 * Both entry points (the in-card AgentActivityRow and the Stack-header
 * AgentHeaderBadge) now `router.push("/[workspace]/issue/[id]/runs")` —
 * the legacy `useRunsSheetStore` is gone since the route system is the
 * single source of truth for what's open.
 *
 * The timeline (MYS-2084) answers what the two lists cannot: which runs spent
 * the issue's money, when, and which agent did the work. It is built ONCE here
 * and handed to both the strip and the full chart, so the strip's end reading,
 * the chart's curve and the stat row are one projection and cannot disagree.
 * Every figure is priced through the same `summarizeTaskUsage` the header chip
 * and the breakdown dialog use — one cost formula in the product.
 *
 * Rows are collapsible in both sections: past (terminal) runs expand to an
 * inline execution-log panel (`RunLog`), and active runs expand to the same
 * panel in `live` mode — a short poll keeps the still-growing trace
 * refreshing, so a running agent's work-in-progress is inspectable just like
 * web's live transcript.
 */
import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { AgentTask } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { RunRow } from "@/components/issue/run-row";
import {
  RunSpendStrip,
  RunTimelinePanel,
} from "@/components/issue/run-timeline-panel";
import { UsageBreakdownDialog } from "@/components/issue/usage-breakdown-dialog";
import {
  issueActiveTasksOptions,
  issueDetailOptions,
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
import { collectUnmappedModels } from "@/lib/runtime-usage";
import { buildRunTimeline, timelineUsageRows } from "@/lib/issue-run-timeline";
import { useCustomPricingStore } from "@/lib/custom-pricing-store";

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

  // Issue detail supplies the human identifier for the breakdown subtitle
  // ("MYS-568 · 5 runs"). Already cached — the runs sheet is pushed from the
  // issue detail Stack, so this is not a new request in practice.
  const { data: issue } = useQuery(issueDetailOptions(wsId, id));
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);

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

  // `pricings` is never read, it is a dependency: `estimateCost` pulls custom
  // rates imperatively out of the zustand store, so without the subscription
  // every priced figure here — the strip, the chart, the chip — would keep
  // showing a pre-override price until the task query happened to refetch (web
  // execution-log-section.tsx:247 does the same).
  const pricings = useCustomPricingStore((s) => s.pricings);

  // Issue-level usage total, mirroring web's IssueUsageTotal on the
  // execution-log header: null when NO run has recorded usage → chip hides.
  const usageTotal = useMemo(
    () => summarizeTaskUsageAcross(allTasks.map((task) => task.usage)),
    [allTasks, pricings],
  );

  // ONE timeline for the whole sheet. Active runs stretch to "now"; the clock
  // is read when the task list changes or the timeline is toggled, not on a
  // ticker — the bars move by minutes, and the rows below run their own live
  // timer. `nowMs` rides along so the strip's "Today" / "Now" labels are the
  // same instant the bars were laid out against.
  const { timeline, nowMs } = useMemo(() => {
    const at = Date.now();
    return { timeline: buildRunTimeline(allTasks, at), nowMs: at };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `pricings` re-prices; `timelineOpen` re-reads the clock
  }, [allTasks, pricings, timelineOpen]);
  const unmapped = useMemo(
    () => collectUnmappedModels(timelineUsageRows(timeline.runs)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `pricings` changes which models are priced
    [timeline, pricings],
  );

  return (
    <View className="flex-1">
      <View className="px-4 pt-4 pb-3">
        <View className="flex-row items-center justify-between gap-2">
          <Text className="flex-1 text-title-sm font-semibold text-foreground">
            {t("runs.agentRuns")}
          </Text>
          {usageTotal ? (
            <UsageTotalChip total={usageTotal} onPress={() => setBreakdownOpen(true)} />
          ) : null}
        </View>
        {/* The spend strip sits in the scroll body below so it lines up with
            the rest of the sheet, not in this fixed header. */}
      </View>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View className="px-4 gap-3 pb-4">
          {/* The strip is the always-visible answer to "was this expensive,
              and when"; the full chart behind the toggle is the follow-up
              ("which run, which agent"). Web puts the same strip in its
              execution-log sidebar with the same relationship to its dialog.
              The strip is itself the affordance, so the separate button below
              only appears when there is no strip — i.e. when nothing was
              priced and the strip renders nothing. Two controls for one
              action would just split the tap target. */}
          <RunSpendStrip
            timeline={timeline}
            nowMs={nowMs}
            onOpen={() => setTimelineOpen(true)}
          />
          {timelineOpen && timeline.runs.length > 0 ? (
            <>
              <View className="flex-row items-center justify-between">
                <Text className="text-micro font-medium uppercase tracking-wider text-muted-foreground">
                  {t("runsTimeline.title")}
                </Text>
                <Pressable
                  onPress={() => setTimelineOpen(false)}
                  accessibilityRole="button"
                  accessibilityLabel={t("runs.collapseTimeline")}
                  hitSlop={8}
                  className="rounded-md px-2 py-0.5 active:opacity-70"
                >
                  <Text className="text-caption text-muted-foreground">
                    {t("runs.collapseTimeline")}
                  </Text>
                </Pressable>
              </View>
              <RunTimelinePanel timeline={timeline} unmapped={unmapped} />
            </>
          ) : null}
          {timeline.runs.length > 0 && !timelineOpen && timeline.pricedCount === 0 ? (
            <Pressable
              onPress={() => setTimelineOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={t("runsTimeline.openFull")}
              className="flex-row items-center justify-center gap-1.5 rounded-md border border-border py-2 active:opacity-70"
            >
              <Text className="text-caption font-medium text-foreground">
                {t("runsTimeline.openFull")}
              </Text>
            </Pressable>
          ) : null}
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

      <UsageBreakdownDialog
        visible={breakdownOpen}
        onClose={() => setBreakdownOpen(false)}
        identifier={issue?.identifier ?? ""}
        tasks={allTasks}
      />
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
      <Text className="text-micro font-medium text-muted-foreground uppercase tracking-wide">
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
 * would be a lie. Tapping it opens the per-run usage breakdown dialog
 * (`UsageBreakdownDialog`), whose figures come from the same
 * `summarizeTaskUsage` source — so the dialog's total can never disagree
 * with the chip that opened it.
 */
function UsageTotalChip({
  total,
  onPress,
}: {
  total: TaskUsageSummary;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      accessible
      accessibilityRole="button"
      accessibilityLabel={t("runs.usageTotal")}
      className="flex-row items-center gap-1 rounded-md bg-secondary px-2 py-1 active:opacity-70"
    >
      <Text className="text-caption font-medium text-foreground tabular-nums">
        {formatTokens(total.tokens)}
      </Text>
      <Text className="text-caption text-muted-foreground">·</Text>
      <Text className="text-caption text-muted-foreground tabular-nums">
        {formatUsd(total.cost)}
      </Text>
    </Pressable>
  );
}
