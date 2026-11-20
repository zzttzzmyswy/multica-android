/**
 * Gantt view for the issue workbench — mobile port of web's
 * `packages/views/issues/components/gantt-view.tsx`, phone-adapted:
 *
 *   - The timeline scrolls horizontally; the left label column is a pinned
 *     pane outside that scroll (web's sticky left cell) and the two panes
 *     sync their vertical scroll so rows stay aligned.
 *   - The vertical axis renders month blocks + day/week/month ticks in one
 *     header row (web splits them into two sticky rows; a phone saves the
 *     height). Today line, weekend shading and month gridlines carry over.
 *   - Zoom (day/week/month) + "show completed" stay reachable above the
 *     canvas, including when filtering removes every row.
 *   - All geometry (range padding, bar left/width, inverted normalization,
 *     show-completed filtering) comes from `lib/gantt.ts` so the
 *     rules stay unit-testable — this component only draws.
 *   - Tap a row or bar → open the issue (same navigation contract as the
 *     list/board/table views).
 */
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import type { Issue } from "@multica/core/types";
import { useQuery } from "@tanstack/react-query";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Text } from "@/components/ui/text";
import { StatusIcon } from "@/components/ui/status-icon";
import { PriorityIcon } from "@/components/ui/priority-icon";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { ProjectIcon } from "@/components/ui/project-icon";
import { useTranslation } from "@/lib/i18n/react";
import { THEME } from "@/lib/theme";
import { projectListOptions } from "@/data/queries/projects";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useFontScale } from "@/data/stores/type-appearance-store";
import { sortIssues } from "@/lib/filter-issues";
import type { IssueSortDirection, IssueSortField } from "@/data/stores/issue-filter-slice";
import {
  DAY_PX_BY_ZOOM,
  addDaysUTC as addDays,
  computeGanttRange,
  daysBetween,
  ganttBarGeometry,
  ganttCanvasRows,
  ganttPhoneLayout,
  isMonthStartUTC,
  isWeekendUTC,
  isWeekStartUTC,
  utcDay,
  type GanttRange,
  type GanttZoom,
} from "@/lib/gantt";
import { useThemePalette } from "@/lib/appearance-a11y-runtime";

const HEADER_HEIGHT = 48;

const ZOOMS: { value: GanttZoom; labelKey: string }[] = [
  { value: "day", labelKey: "issues.gantt.zoomDay" },
  { value: "week", labelKey: "issues.gantt.zoomWeek" },
  { value: "month", labelKey: "issues.gantt.zoomMonth" },
];

/** Bar fill per status CATEGORY (custom statuses collapse into their
 *  category — same bucket the board lanes use). Semantic tokens, not
 *  hardcoded colors. */
const CATEGORY_BAR_COLOR: Record<string, string> = {
  backlog: "mutedForeground",
  todo: "mutedForeground",
  in_progress: "warning",
  in_review: "success",
  done: "info",
  blocked: "destructive",
  cancelled: "mutedForeground",
};

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** One scheduled row — fixed label cell (left column, outside the h-scroll). */
const GanttLabelCell = memo(function GanttLabelCell({
  issue,
  projectIcon,
  borderColor,
  rowHeight,
  compact,
  onPress,
}: {
  issue: Issue;
  projectIcon: string | null | undefined;
  borderColor: string;
  rowHeight: number;
  compact: boolean;
  onPress: (issue: Issue) => void;
}) {
  return (
    <Pressable
      onPress={() => onPress(issue)}
      accessibilityRole="button"
      accessibilityLabel={`${issue.identifier}, ${issue.title}`}
      className="flex-row items-center gap-2 px-2 active:bg-secondary"
      style={{ height: rowHeight, borderBottomWidth: 0.5, borderColor }}
    >
      <View className="min-w-0 flex-1 gap-0.5">
        <View className="flex-row items-center gap-1.5">
          <StatusIcon status={issue.status} size={13} />
          {!compact ? <PriorityIcon priority={issue.priority} size={12} /> : null}
          <Text
            numberOfLines={1}
            className="shrink text-caption text-muted-foreground tabular-nums"
          >
            {issue.identifier}
          </Text>
        </View>
        <Text numberOfLines={2} className="text-caption font-medium text-foreground">
          {issue.title}
        </Text>
      </View>
      {!compact && projectIcon ? <ProjectIcon icon={projectIcon} size="sm" /> : null}
      {!compact && issue.assignee_type && issue.assignee_id ? (
        <ActorAvatar type={issue.assignee_type} id={issue.assignee_id} size={16} />
      ) : null}
    </Pressable>
  );
});

/** One scheduled row — absolute bar on the timeline track. Lives inside the
 *  horizontal ScrollView only (labels live in the pinned left column). */
const GanttRow = memo(function GanttRow({
  issue,
  range,
  dayPx,
  totalDays,
  barColor,
  rowHeight,
  onPress,
}: {
  issue: Issue;
  range: GanttRange;
  dayPx: number;
  totalDays: number;
  barColor: string;
  rowHeight: number;
  onPress: (issue: Issue) => void;
}) {
  const bar = ganttBarGeometry({
    start: utcDay(issue.start_date),
    due: utcDay(issue.due_date),
    range,
    totalDays,
    dayPx,
  });
  const trackWidth = totalDays * dayPx;

  return (
    <View style={{ height: rowHeight, width: trackWidth }}>
      {bar ? (
        <Pressable
          onPress={() => onPress(issue)}
          accessibilityRole="button"
          accessibilityLabel={`${issue.identifier}, ${issue.title}`}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          style={{
            position: "absolute",
            top: rowHeight / 2 - (bar.isMarker ? 6 : 9),
            left: bar.left,
            width: bar.isMarker ? 12 : Math.max(bar.width, 8),
            height: bar.isMarker ? 12 : 18,
            backgroundColor: barColor,
            borderRadius: bar.isMarker ? 2 : 5,
            transform: bar.isMarker ? [{ rotate: "45deg" }] : undefined,
            borderWidth: bar.inverted ? 2 : 0,
            borderColor: bar.inverted ? THEME.light.destructive : undefined,
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {!bar.isMarker && bar.width > 60 ? (
            <Text numberOfLines={1} className="px-1.5 text-micro leading-3 text-white">
              {issue.title}
            </Text>
          ) : null}
        </Pressable>
      ) : null}
    </View>
  );
});

export function GanttView({
  issues,
  sortBy,
  sortDirection,
  onOpenIssue,
  emptyLabel,
}: {
  issues: Issue[];
  sortBy: IssueSortField;
  sortDirection: IssueSortDirection;
  onOpenIssue: (issue: Issue) => void;
  emptyLabel: string;
}) {
  const { t } = useTranslation();
  const theme = useThemePalette();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { width, fontScale } = useWindowDimensions();
  const appFontScale = useFontScale();
  const { labelWidth, rowHeight, compact } = ganttPhoneLayout(
    width,
    fontScale * (appFontScale ?? 1),
  );

  const [zoom, setZoom] = useState<GanttZoom>("week");
  const [showCompleted, setShowCompleted] = useState(false);

  const { data: projects = [] } = useQuery({
    ...projectListOptions(wsId),
    enabled: !!wsId && issues.some((i) => i.project_id),
  });
  const projectById = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const p of projects) map.set(p.id, p.icon);
    return map;
  }, [projects]);

  const today = useMemo(() => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }, []);

  // Canvas rows — shared filters applied upstream; this adds the gantt-only
  // rules (needs a date, completed hidden unless asked). Mirrors web
  // `ganttCanvasRows` via `lib/gantt.ts`.
  const scheduled = useMemo(() => {
    const sortField = sortBy === "position" ? "start_date" : sortBy;
    return sortIssues(ganttCanvasRows(issues, showCompleted), sortField, sortDirection);
  }, [issues, showCompleted, sortBy, sortDirection]);

  const hasScheduled = scheduled.length > 0;
  const filteredToEmpty =
    !hasScheduled && !showCompleted && ganttCanvasRows(issues, true).length > 0;
  const range = useMemo(
    () => computeGanttRange(scheduled, today, zoom),
    [scheduled, today, zoom],
  );
  const totalDays = daysBetween(range.start, range.end);
  const dayPx = DAY_PX_BY_ZOOM[zoom];
  const trackWidth = totalDays * dayPx;
  const todayOffsetDays = daysBetween(range.start, today);

  const scrollRef = useRef<ScrollView>(null);
  const leftScrollRef = useRef<ScrollView>(null);
  const bodyScrollRef = useRef<ScrollView>(null);
  // Shared vertical offset for the two vertically-scrolling panes (label
  // column + timeline body) — keeps them row-aligned. The 0.5px guard
  // dampens the programmatic-scroll → onScroll echo between the panes.
  const vScrollY = useRef(0);
  const syncVertical = (from: "left" | "body", y: number) => {
    vScrollY.current = y;
    const target = from === "left" ? bodyScrollRef.current : leftScrollRef.current;
    target?.scrollTo({ y, animated: false });
  };
  useEffect(() => {
    // Center today near the left edge on mount / zoom change — web scrolls
    // the today line ~240px into view.
    if (!hasScheduled) {
      vScrollY.current = 0;
      return;
    }
    const target = Math.max(0, todayOffsetDays * dayPx - 100);
    scrollRef.current?.scrollTo({ x: target, animated: false });
  }, [dayPx, todayOffsetDays, hasScheduled]);

  const monthBlocks = useMemo(() => {
    const out: { label: string; left: number; width: number }[] = [];
    let cursor = range.start;
    while (cursor.getTime() < range.end.getTime()) {
      const monthEnd = new Date(
        Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1),
      );
      const blockEnd = monthEnd.getTime() > range.end.getTime() ? range.end : monthEnd;
      const startDays = daysBetween(range.start, cursor);
      const widthDays = daysBetween(cursor, blockEnd);
      out.push({
        label: `${MONTH_NAMES[cursor.getUTCMonth()]} ${cursor.getUTCFullYear()}`,
        left: startDays * dayPx,
        width: widthDays * dayPx,
      });
      cursor = monthEnd;
    }
    return out;
  }, [range, dayPx]);

  const dayTicks = useMemo(() => {
    const out: { date: Date; showLabel: boolean; isMonth: boolean; isWeek: boolean }[] = [];
    for (let i = 0; i < totalDays; i++) {
      const date = addDays(range.start, i);
      out.push({
        date,
        showLabel:
          zoom === "day" ||
          (zoom === "week" && isWeekStartUTC(date)) ||
          (zoom === "month" && isMonthStartUTC(date)),
        isMonth: isMonthStartUTC(date),
        isWeek: isWeekStartUTC(date),
      });
    }
    return out;
  }, [range, totalDays, zoom]);

  const barColorFor = useMemo(() => {
    return (issue: Issue) => {
      const key = issue.status_category ?? issue.status;
      const token = (CATEGORY_BAR_COLOR as Record<string, keyof typeof THEME.light>)[key] ?? "mutedForeground";
      return theme[token];
    };
  }, [theme]);

  return (
    <View className="flex-1">
      {/* Toolbar — zoom segmented control + show-completed toggle */}
      <View
        className="flex-row flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-3 py-2"
      >
        <View
          className="max-w-full flex-row flex-wrap gap-1 rounded-xl border border-border bg-secondary/30 p-1"
          accessibilityLabel={t("issues.gantt.tooltip.zoom")}
        >
          {ZOOMS.map((opt) => {
            const active = zoom === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => setZoom(opt.value)}
                className={`min-h-12 min-w-12 max-w-full items-center justify-center rounded-lg px-2 py-1 ${active ? "bg-accent" : "active:bg-secondary"}`}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={t(opt.labelKey)}
              >
                <Text
                  className={`text-center text-caption ${active ? "text-foreground font-medium" : "text-muted-foreground"}`}
                >
                  {t(opt.labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          onPress={() => setShowCompleted((v) => !v)}
          className="min-h-12 max-w-full flex-row items-center gap-2 rounded-xl border border-border px-3 py-1 active:bg-secondary"
          accessibilityRole="switch"
          accessibilityState={{ checked: showCompleted }}
          accessibilityHint={t("issues.gantt.tooltip.showCompleted")}
          accessibilityLabel={t("issues.gantt.showCompleted")}
        >
          <MaterialCommunityIcons
            name={showCompleted ? "toggle-switch" : "toggle-switch-off"}
            size={20}
            color={showCompleted ? theme.primary : theme.mutedForeground}
          />
          <Text
            className={`shrink text-caption ${showCompleted ? "text-foreground" : "text-muted-foreground"}`}
          >
            {t("issues.gantt.showCompleted")}
          </Text>
        </Pressable>
      </View>

      {/* Canvas — pinned left label column + horizontal timeline. The label
          column lives OUTSIDE the horizontal ScrollView (labels never scroll
          under the ticks); vertical scroll is shared via onScroll sync so the
          two panes stay row-aligned. */}
      {!hasScheduled ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-center text-body text-muted-foreground">
            {filteredToEmpty ? t("issues.filterEmpty") : emptyLabel}
          </Text>
        </View>
      ) : (
        <View className="flex-1 flex-row">
          {/* Both headers stay out of the synchronized vertical scroll. */}
          <View style={{ width: labelWidth, borderRightWidth: 0.5, borderColor: theme.border }}>
            <View style={{ height: HEADER_HEIGHT }} className="justify-end border-b border-border px-2 pb-1.5">
              <Text className="text-caption font-medium text-muted-foreground" numberOfLines={2}>
                {t("issues.gantt.headerIssue")}
              </Text>
            </View>
            <ScrollView
              ref={leftScrollRef}
              showsVerticalScrollIndicator={false}
              scrollEventThrottle={16}
              onScroll={(e) => {
                const y = e.nativeEvent.contentOffset.y;
                if (Math.abs(y - vScrollY.current) > 0.5) syncVertical("left", y);
              }}
              className="flex-1"
            >
              {scheduled.map((issue) => {
                const projectIcon = issue.project_id ? projectById.get(issue.project_id) : undefined;
                return (
                  <GanttLabelCell
                    key={issue.id}
                    issue={issue}
                    projectIcon={projectIcon}
                    borderColor={theme.border}
                    rowHeight={rowHeight}
                    compact={compact}
                    onPress={onOpenIssue}
                  />
                );
              })}
            </ScrollView>
          </View>
          {/* Timeline — header (month + ticks) + rows scroll horizontally; the
              inner vertical ScrollView syncs with the label column. */}
          <ScrollView
            ref={scrollRef}
            className="flex-1"
            horizontal
            nestedScrollEnabled
            scrollEventThrottle={16}
          >
            <View className="self-stretch" style={{ width: trackWidth }}>
              {/* Header */}
              <View className="border-b border-border" style={{ height: HEADER_HEIGHT }}>
                {/* Month row */}
                <View style={{ position: "absolute", left: 0, top: 0, height: 22, width: trackWidth }}>
                  {monthBlocks.map((b, i) => (
                    <View
                      key={i}
                      style={{ position: "absolute", left: b.left, width: b.width, top: 0, bottom: 0, justifyContent: "center", paddingLeft: 4 }}
                    >
                      {b.width > 40 ? (
                        <Text numberOfLines={1} className="text-micro font-medium text-muted-foreground">
                          {b.label}
                        </Text>
                      ) : null}
                    </View>
                  ))}
                </View>
                {/* Day/week/month tick row */}
                <View style={{ position: "absolute", left: 0, top: 22, height: 26, width: trackWidth }}>
                  {dayTicks.map((tick, i) => (
                    <View
                      key={i}
                      style={{
                        position: "absolute",
                        left: i * dayPx,
                        width: dayPx,
                        top: 0,
                        bottom: 0,
                        alignItems: "center",
                        justifyContent: "center",
                        borderLeftWidth: 0.5,
                        borderColor: tick.isMonth
                          ? theme.border
                          : tick.isWeek
                            ? theme.border
                            : theme.muted,
                      }}
                    >
                      {tick.showLabel ? (
                        zoom === "day" ? (
                          <Text className="text-micro leading-none text-muted-foreground tabular-nums">
                            {tick.date.getUTCDate()}
                          </Text>
                        ) : zoom === "week" ? (
                          <Text className="text-micro leading-none text-muted-foreground tabular-nums">
                            {tick.date.getUTCDate()}
                          </Text>
                        ) : (
                          <Text className="text-micro leading-none text-muted-foreground tabular-nums whitespace-nowrap">
                            {MONTH_NAMES[tick.date.getUTCMonth()]} {tick.date.getUTCDate()}
                          </Text>
                        )
                      ) : null}
                    </View>
                  ))}
                </View>
                {todayOffsetDays >= 0 && todayOffsetDays <= totalDays ? (
                  <View
                    style={{
                      position: "absolute",
                      left: todayOffsetDays * dayPx,
                      top: 0,
                      bottom: 0,
                      width: 1,
                      backgroundColor: theme.brand,
                    }}
                  />
                ) : null}
              </View>

              {/* Rows + background gridlines, bounded below the fixed header. */}
              <ScrollView
                ref={bodyScrollRef}
                className="flex-1"
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}
                scrollEventThrottle={16}
                onScroll={(e) => {
                  const y = e.nativeEvent.contentOffset.y;
                  if (Math.abs(y - vScrollY.current) > 0.5) syncVertical("body", y);
                }}
              >
                <View style={{ height: scheduled.length * rowHeight }}>
                  {/* Background gridlines + today line spanning all rows */}
                  <View
                    pointerEvents="none"
                    style={{ position: "absolute", left: 0, top: 0, width: trackWidth, height: scheduled.length * rowHeight }}
                  >
                    {dayTicks.map((tick, i) => (
                      <View
                        key={i}
                        style={{
                          position: "absolute",
                          left: i * dayPx,
                          width: dayPx,
                          top: 0,
                          bottom: 0,
                          backgroundColor: isWeekendUTC(tick.date) ? theme.muted : "transparent",
                          opacity: isWeekendUTC(tick.date) ? 0.4 : 1,
                          borderLeftWidth: tick.isMonth || tick.isWeek ? 0.5 : 0,
                          borderColor: tick.isMonth ? theme.border : theme.muted,
                        }}
                      />
                    ))}
                    {todayOffsetDays >= 0 && todayOffsetDays <= totalDays ? (
                      <View
                        style={{
                          position: "absolute",
                          left: todayOffsetDays * dayPx,
                          top: 0,
                          bottom: 0,
                          width: 1,
                          backgroundColor: theme.brand,
                        }}
                      />
                    ) : null}
                  </View>
                  {scheduled.map((issue) => (
                    <GanttRow
                      key={issue.id}
                      issue={issue}
                      range={range}
                      dayPx={dayPx}
                      totalDays={totalDays}
                      barColor={barColorFor(issue)}
                      rowHeight={rowHeight}
                      onPress={onOpenIssue}
                    />
                  ))}
                </View>
              </ScrollView>
            </View>
          </ScrollView>
        </View>
      )}
    </View>
  );
}
