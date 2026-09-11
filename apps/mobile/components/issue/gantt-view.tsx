/**
 * Gantt view for the issue workbench — mobile port of web's
 * `packages/views/issues/components/gantt-view.tsx`, phone-adapted:
 *
 *   - A single horizontal ScrollView drives the timeline; the left label
 *     column stays pinned (absolute overlay, scroll offset compensated) so
 *     identifiers remain readable while scrubbing dates — web's sticky
 *     left cell.
 *   - The vertical axis renders month blocks + day/week/month ticks in one
 *     header row (web splits them into two sticky rows; a phone saves the
 *     height). Today line, weekend shading and month gridlines carry over.
 *   - Zoom (day/week/month) + "show completed" live in a compact toolbar
 *     row above the canvas, mirroring web's toolbar semantics.
 *   - All geometry (range padding, bar left/width, inverted normalization,
 *     show-completed filtering) comes from `lib/issue-gantt.ts` so the
 *     rules stay unit-testable — this component only draws.
 *   - Tap a row or bar → open the issue (same navigation contract as the
 *     list/board/table views).
 */
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from "react-native";
import type { Issue } from "@multica/core/types";
import { useQuery } from "@tanstack/react-query";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Text } from "@/components/ui/text";
import { StatusIcon } from "@/components/ui/status-icon";
import { PriorityIcon } from "@/components/ui/priority-icon";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { ProjectIcon } from "@/components/ui/project-icon";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { projectListOptions } from "@/data/queries/projects";
import { useWorkspaceStore } from "@/data/workspace-store";
import { sortIssues } from "@/lib/filter-issues";
import type { IssueSortDirection, IssueSortField } from "@/data/stores/issue-filter-slice";
import {
  DAY_PX_BY_ZOOM,
  addDaysUTC as addDays,
  computeGanttRange,
  daysBetween,
  ganttBarGeometry,
  ganttCanvasRows,
  ganttInverted,
  isMonthStartUTC,
  isWeekendUTC,
  isWeekStartUTC,
  utcDay,
  type GanttRange,
  type GanttZoom,
} from "@/lib/gantt";

const ROW_HEIGHT = 44;
const HEADER_HEIGHT = 48;
const LEFT_COL_WIDTH = 250;
const TOOLBAR_HEIGHT = 40;

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

/** One scheduled row — pinned label cell + absolute bar on the track. */
const GanttRow = memo(function GanttRow({
  issue,
  range,
  dayPx,
  totalDays,
  projectIcon,
  barColor,
  borderColor,
  labelBg,
  onPress,
}: {
  issue: Issue;
  range: GanttRange;
  dayPx: number;
  totalDays: number;
  projectIcon: string | null | undefined;
  barColor: string;
  borderColor: string;
  labelBg: string;
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
    <View style={{ height: ROW_HEIGHT, width: LEFT_COL_WIDTH + trackWidth }} className="flex-row">
      <Pressable
        onPress={() => onPress(issue)}
        className="flex-row items-center gap-1.5 px-2"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: LEFT_COL_WIDTH,
          backgroundColor: labelBg,
          zIndex: 1,
          borderBottomWidth: 0.5,
          borderColor,
        }}
      >
        <StatusIcon status={issue.status} size={13} />
        <PriorityIcon priority={issue.priority} size={12} />
        <Text
          numberOfLines={1}
          className="text-[10px] text-muted-foreground tabular-nums"
          style={{ width: 52 }}
        >
          {issue.identifier}
        </Text>
        <Text numberOfLines={1} className="flex-1 text-xs">
          {issue.title}
        </Text>
        {projectIcon ? <ProjectIcon icon={projectIcon} size="sm" /> : null}
        {issue.assignee_type && issue.assignee_id ? (
          <ActorAvatar type={issue.assignee_type} id={issue.assignee_id} size={16} />
        ) : null}
      </Pressable>
      <View style={{ width: trackWidth }}>
        {bar ? (
          <Pressable
            onPress={() => onPress(issue)}
            style={{
              position: "absolute",
              top: ROW_HEIGHT / 2 - (bar.isMarker ? 6 : 9),
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
              <Text numberOfLines={1} className="px-1.5 text-[9px] leading-3 text-white">
                {issue.title}
              </Text>
            ) : null}
          </Pressable>
        ) : null}
      </View>
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
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { width: windowWidth } = useWindowDimensions();

  const [zoom, setZoom] = useState<GanttZoom>("week");
  const [showCompleted, setShowCompleted] = useState(false);
  const [scrollX, setScrollX] = useState(0);

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
  // `ganttCanvasRows` via `lib/issue-gantt.ts`.
  const scheduled = useMemo(() => {
    const sortField = sortBy === "position" ? "start_date" : sortBy;
    return sortIssues(ganttCanvasRows(issues, showCompleted), sortField, sortDirection);
  }, [issues, showCompleted, sortBy, sortDirection]);

  const range = useMemo(
    () => computeGanttRange(scheduled, today, zoom),
    [scheduled, today, zoom],
  );
  const totalDays = daysBetween(range.start, range.end);
  const dayPx = DAY_PX_BY_ZOOM[zoom];
  const trackWidth = totalDays * dayPx;
  const todayOffsetDays = daysBetween(range.start, today);

  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    // Center today near the left edge on mount / zoom change — web scrolls
    // the today line ~240px into view.
    const target = Math.max(0, todayOffsetDays * dayPx - 100);
    scrollRef.current?.scrollTo({ x: target, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

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

  if (scheduled.length === 0) {
    return (
      <View className="flex-1 items-center justify-center px-8">
        <Text className="text-center text-sm text-muted-foreground">{emptyLabel}</Text>
      </View>
    );
  }

  const labelVisibleWidth = Math.min(LEFT_COL_WIDTH, Math.max(140, windowWidth * 0.38));

  return (
    <View className="flex-1">
      {/* Toolbar — zoom segmented control + show-completed toggle */}
      <View
        className="flex-row items-center gap-2 border-b border-border px-3"
        style={{ height: TOOLBAR_HEIGHT }}
      >
        <View className="flex-row rounded-md border border-border p-0.5">
          {ZOOMS.map((opt) => {
            const active = zoom === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => setZoom(opt.value)}
                className={`rounded px-2 py-0.5 ${active ? "bg-accent" : ""}`}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={t(opt.labelKey)}
              >
                <Text
                  className={`text-[11px] ${active ? "text-foreground font-medium" : "text-muted-foreground"}`}
                >
                  {t(opt.labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View className="flex-1" />
        <Pressable
          onPress={() => setShowCompleted((v) => !v)}
          className="flex-row items-center gap-1 rounded-md border border-border px-2 py-1"
          accessibilityRole="button"
          accessibilityState={{ selected: showCompleted }}
          accessibilityLabel={t("issues.gantt.showCompleted")}
        >
          <MaterialCommunityIcons
            name={showCompleted ? "toggle-switch" : "toggle-switch-off"}
            size={14}
            color={showCompleted ? theme.primary : theme.mutedForeground}
          />
          <Text
            className={`text-[11px] ${showCompleted ? "text-foreground" : "text-muted-foreground"}`}
          >
            {t("issues.gantt.showCompleted")}
          </Text>
        </Pressable>
      </View>

      {/* Canvas — one horizontal ScrollView; left column pinned by an
          absolutely-positioned overlay that hides the scrolled-under labels. */}
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(e) => setScrollX(e.nativeEvent.contentOffset.x)}
      >
        <View>
          {/* Header */}
          <View
            className="flex-row border-b border-border"
            style={{ height: HEADER_HEIGHT, width: LEFT_COL_WIDTH + trackWidth }}
          >
            <View
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: LEFT_COL_WIDTH,
                backgroundColor: theme.background,
                zIndex: 2,
                borderRightWidth: 0.5,
                borderColor: theme.border,
              }}
            />
            <View
              style={{
                position: "absolute",
                left: scrollX,
                top: 0,
                bottom: 0,
                width: labelVisibleWidth,
                zIndex: 3,
                justifyContent: "flex-end",
                paddingBottom: 6,
                paddingLeft: 12,
              }}
              pointerEvents="none"
            >
              <Text className="text-[10px] font-medium text-muted-foreground">
                {t("issues.gantt.headerIssue")}
              </Text>
            </View>
            {/* Month row */}
            <View style={{ position: "absolute", left: LEFT_COL_WIDTH, top: 0, height: 22, width: trackWidth }}>
              {monthBlocks.map((b, i) => (
                <View
                  key={i}
                  style={{ position: "absolute", left: b.left, width: b.width, top: 0, bottom: 0, justifyContent: "center", paddingLeft: 4 }}
                >
                  {b.width > 40 ? (
                    <Text numberOfLines={1} className="text-[10px] font-medium text-muted-foreground">
                      {b.label}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
            {/* Day/week/month tick row */}
            <View
              style={{ position: "absolute", left: LEFT_COL_WIDTH, top: 22, height: 26, width: trackWidth }}
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
                      <Text className="text-[8px] leading-none text-muted-foreground tabular-nums">
                        {tick.date.getUTCDate()}
                      </Text>
                    ) : zoom === "week" ? (
                      <Text className="text-[9px] leading-none text-muted-foreground tabular-nums">
                        {tick.date.getUTCDate()}
                      </Text>
                    ) : (
                      <Text className="text-[8px] leading-none text-muted-foreground tabular-nums whitespace-nowrap">
                        {MONTH_NAMES[tick.date.getUTCMonth()]} {tick.date.getUTCDate()}
                      </Text>
                    )
                  ) : null}
                </View>
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
          </View>

          {/* Rows */}
          <View style={{ width: LEFT_COL_WIDTH + trackWidth }}>
            {/* Background gridlines + today line spanning all rows */}
            <View
              pointerEvents="none"
              style={{ position: "absolute", left: LEFT_COL_WIDTH, top: 0, width: trackWidth, height: scheduled.length * ROW_HEIGHT }}
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
            {scheduled.map((issue) => {
              const projectIcon = issue.project_id ? projectById.get(issue.project_id) : undefined;
              const inverted = ganttInverted(issue.start_date, issue.due_date);
              return (
                <View key={issue.id} className="border-b border-border/50">
                  <GanttRow
                    issue={issue}
                    range={range}
                    dayPx={dayPx}
                    totalDays={totalDays}
                    projectIcon={projectIcon}
                    barColor={barColorFor(issue)}
                    borderColor={theme.border}
                    labelBg={theme.background}
                    onPress={onOpenIssue}
                  />
                  {inverted ? (
                    <View style={{ position: "absolute", left: 8, bottom: 2 }} pointerEvents="none">
                      <Text className="text-[9px] text-destructive">
                        {t("issues.gantt.invertedDatesWarning")}
                      </Text>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
