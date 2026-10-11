/**
 * The issue's runs as a picture — mobile port of web's `RunTimelineChart` +
 * `RunStats` + `RunDayList` (`packages/views/issues/components/issue-runs-dialog.tsx`,
 * MYS-2084).
 *
 * Web draws one chart: a cumulative cost curve over per-agent run lanes on a
 * single time axis, with the peak run labelled and a pointer crosshair that
 * names whatever is under it. All the arithmetic comes from
 * `lib/issue-run-timeline.ts` — this file only maps numbers to pixels, exactly
 * as web's does.
 *
 * Deliberate deviations from web, each noted at its site:
 *  - **the readout is a fixed row under the plot, not a floating card.**
 *    Web's card is `max-w-72` and floats beside the crosshair, which works on a
 *    1024px dialog. At phone width the card would cover the curve it is
 *    describing. A dedicated row also means the numbers never move as the
 *    finger travels, so they can be read after the drag ends.
 *  - **the scrub is `onTouchStart/Move` on the plot, not `pointermove`.** A
 *    phone has no hover; a drag is the same question asked with a finger.
 *    `lib/run-timeline-scrub.ts` holds the pixel→time math so it is testable.
 *  - **no per-run cost bar in the day list.** Web's `CostCell` opens a popover
 *    splitting a run into input/output/cache segments. On a phone that detail
 *    already has a home — the runs sheet's total chip opens
 *    `UsageBreakdownDialog`, which carries the same four columns per run. A
 *    second, smaller copy here would be a second place for the same figures to
 *    disagree.
 *  - **the day list is a grouped list, not a bordered table row.** Each run is
 *    a row of the runs sheet's own shape, so the timeline reads as the same
 *    surface as the list above it.
 */
import { useMemo, useRef, useState } from "react";
import { Pressable, View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import Svg, { Path } from "react-native-svg";
import type { AgentTask } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { useActorLookup } from "@/data/use-actor-name";
import { useTranslation, useIntlLocale } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { formatDuration } from "@/lib/usage-time";
import { formatUsd } from "@/lib/task-usage";
import {
  groupRunsByDay,
  niceTicks,
  stepCurvePath,
  timeTicks,
  type RunTimeline,
  type TimelineRun,
} from "@/lib/issue-run-timeline";
import { axisEndKinds, dayLabelKind, isMultiDay, type DayLabelKind } from "@/lib/run-timeline-format";
import {
  formatTick,
  lastStepDot,
  readoutAt,
  readoutDot,
  xPctAt,
  type ScrubPlot,
} from "@/lib/run-timeline-scrub";

/** Below one second `formatDuration` falls back to its caller's label. */
const UNDER_A_SECOND = "0s";

/** Height of the spend strip's curve, and of its run track. */
const SPARK_HEIGHT = 34;
const SPARK_TRACK_HEIGHT = 8;
/** The strip's curve tops out a little below its box, so the dot at its end has
 *  room. Same headroom web uses. */
const SPARK_HEADROOM = 0.9;

/** Height of the curve's plot box. Zero when nothing is priced — the lanes
 *  still show when each run happened, and an empty box would be a lie about
 *  scale. */
const PLOT_HEIGHT = 112;
/** Height of one agent's lane track, plus the gap between lanes. */
const LANE_HEIGHT = 14;
const LANE_GAP = 6;
const LANE_LABEL_WIDTH = 92;
/** Width reserved at the right for the y scale, where the curve ends. */
const Y_AXIS_WIDTH = 46;

/**
 * The timeline's chart, stats and day list.
 *
 * Takes the built `timeline` rather than the task list, so the spend strip at
 * the top of the sheet and everything in here read the SAME projection — "总花
 * 费 / 智能体工作 / 历时 / 运行次数" and the curve's end label come from one
 * object and cannot disagree.
 */
export function RunTimelinePanel({
  timeline,
  unmapped,
}: {
  timeline: RunTimeline;
  /** Pricing keys with no rate on file — their tokens count, their cost does
   *  not. Empty when everything resolved. */
  unmapped: readonly string[];
}) {
  const { t } = useTranslation();

  if (timeline.runs.length === 0) return null;

  return (
    <View className="gap-3">
      <RunStats timeline={timeline} />
      <RunTimelineChart timeline={timeline} />
      <RunDayList timeline={timeline} />
      {unmapped.length > 0 || timeline.pricedCount > 0 ? (
        <View className="gap-1 pt-1">
          {unmapped.length > 0 ? (
            <Text className="text-micro text-muted-foreground">
              {t("runsTimeline.noteUnmapped", { models: unmapped.join(", ") })}
            </Text>
          ) : null}
          <Text className="text-micro text-muted-foreground">
            {t("runsTimeline.noteEstimate")}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ─── Spend strip ───────────────────────────────────────────────────────────

/**
 * The issue's whole spend as a miniature of the chart above: the cumulative
 * cost step curve over a track of its runs, on one time axis, with the axis
 * ends labelled.
 *
 * This is the surface that is always visible on the runs sheet — web puts the
 * same strip in its execution-log sidebar and opens the full timeline from it
 * (MUL-7780). Keeping it outside the collapsible means the one question a
 * reader most often has ("was this expensive, and when") is answered without a
 * tap; the full chart below is for the follow-up ("which run, which agent").
 *
 * Not scrubbable, deliberately: the full chart directly below already answers
 * per-run questions with more room, and a second touch target stacked on the
 * first would make both harder to hit. The strip's end dot marks where the
 * curve currently ends.
 */
export function RunSpendStrip({
  timeline,
  nowMs,
  onOpen,
}: {
  timeline: RunTimeline;
  nowMs: number;
  onOpen?: () => void;
}) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const [width, setWidth] = useState(0);

  if (timeline.pricedCount === 0) return null;

  const plot: ScrubPlot = {
    domain: timeline.domain,
    extent: timeline.extent,
    width,
  };
  const yMax = timeline.totalCost / SPARK_HEADROOM;
  const yPct = (cost: number) => (1 - cost / yMax) * 100;
  const { line, area } = stepCurvePath(timeline.cumulative, timeline.domain, yMax);
  const dot = lastStepDot(timeline, plot);

  const [e0, e1] = timeline.extent;
  const kinds = axisEndKinds(timeline.extent, timeline.activeCount, nowMs);
  const clock = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
  const day = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
  const label = (kind: "clock" | "day" | "today" | "now", ms: number) => {
    if (kind === "now") return t("runsTimeline.sparklineNow");
    if (kind === "today") return t("runsTimeline.dayToday");
    if (kind === "clock") return clock.format(ms);
    return day.format(ms);
  };

  const body = (
    <View className="gap-1 rounded-lg border border-border bg-card px-3 py-2.5">
      <View
        accessibilityRole="image"
        accessibilityLabel={t("runsTimeline.stripAria")}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      >
        <View style={{ height: SPARK_HEIGHT }}>
          {width > 0 ? (
            <Svg
              width="100%"
              height="100%"
              viewBox="0 0 1000 100"
              preserveAspectRatio="none"
              style={{ position: "absolute", left: 0, top: 0 }}
            >
              <Path d={area} fill={theme.chart1} fillOpacity={0.1} />
              <Path
                d={line}
                fill="none"
                stroke={theme.chart1}
                strokeWidth={1.5}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </Svg>
          ) : null}
          {dot ? (
            <View
              className="absolute rounded-full"
              style={{
                left: `${dot.xPct}%`,
                top: `${yPct(dot.cost)}%`,
                width: 6,
                height: 6,
                marginLeft: -3,
                marginTop: -3,
                backgroundColor: theme.chart1,
              }}
            />
          ) : null}
        </View>
        {/* One bar per run, at its true position and width on the same axis —
            the strip web replaced its old "12px bars from the left" version
            with, so an issue with three runs no longer draws three bars in a
            corner of an empty track. */}
        <View className="relative mt-1 rounded-full bg-muted" style={{ height: SPARK_TRACK_HEIGHT }}>
          {timeline.runs.map((run) => (
            <View
              key={run.task.id}
              className="absolute top-0 bottom-0 rounded-full"
              style={{
                left: `${xPctAt(run.startMs, plot)}%`,
                width: `${Math.max(xPctAt(run.endMs, plot) - xPctAt(run.startMs, plot), 0.8)}%`,
                backgroundColor: runBarColor(run, run === timeline.peak, theme),
              }}
            />
          ))}
        </View>
        <View className="mt-0.5 flex-row justify-between">
          <Text className="text-micro tabular-nums text-muted-foreground">
            {label(kinds.start, e0)}
          </Text>
          <Text className="text-micro tabular-nums text-muted-foreground">
            {label(kinds.end, e1)}
          </Text>
        </View>
      </View>
    </View>
  );

  if (!onOpen) return body;
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={t("runsTimeline.open")}
      className="active:opacity-70"
    >
      {body}
    </Pressable>
  );
}

// ─── Stats ─────────────────────────────────────────────────────────────────

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="min-w-0">
      <Text className="text-micro font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </Text>
      <View className="mt-0.5 flex-row items-baseline gap-1.5">{children}</View>
    </View>
  );
}

function RunStats({ timeline }: { timeline: RunTimeline }) {
  const { t } = useTranslation();
  const breakdown = [
    timeline.failedCount > 0
      ? t("runsTimeline.countFailed", { count: timeline.failedCount })
      : null,
    timeline.cancelledCount > 0
      ? t("runsTimeline.countCancelled", { count: timeline.cancelledCount })
      : null,
    timeline.activeCount > 0
      ? t("runsTimeline.countActive", { count: timeline.activeCount })
      : null,
  ].filter((s): s is string => s !== null);

  return (
    <View className="flex-row flex-wrap items-end gap-x-6 gap-y-2">
      <Stat label={t("runsTimeline.statSpent")}>
        {/* "—" when nothing reported usage — never $0. A run that predates
            usage reporting was not free, we just don't know. */}
        <Text className="text-title-lg font-semibold text-foreground">
          {timeline.pricedCount > 0 ? formatUsd(timeline.totalCost) : "—"}
        </Text>
      </Stat>
      <Stat label={t("runsTimeline.statAgentTime")}>
        <Text className="text-title-sm font-medium text-foreground">
          {formatDuration(timeline.agentMs / 1000, UNDER_A_SECOND)}
        </Text>
      </Stat>
      <Stat label={t("runsTimeline.statElapsed")}>
        <Text className="text-title-sm font-medium text-foreground">
          {formatDuration(timeline.elapsedMs / 1000, UNDER_A_SECOND)}
        </Text>
      </Stat>
      <Stat label={t("runsTimeline.statRuns")}>
        <Text className="text-title-sm font-medium text-foreground">
          {timeline.runs.length}
        </Text>
        {breakdown.length > 0 ? (
          <Text className="text-caption text-muted-foreground">
            · {breakdown.join(" · ")}
          </Text>
        ) : null}
      </Stat>
    </View>
  );
}

// ─── Chart ─────────────────────────────────────────────────────────────────

export function RunTimelineChart({ timeline }: { timeline: RunTimeline }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const { getName } = useActorLookup();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  const [plotWidth, setPlotWidth] = useState(0);
  const [readoutX, setReadoutX] = useState<number | null>(null);
  const plotWidthRef = useRef(0);

  const pricing = timeline.pricedCount > 0;
  const plotHeight = pricing ? PLOT_HEIGHT : 0;

  const yTicks = niceTicks(timeline.totalCost);
  const yMax = yTicks[yTicks.length - 1] ?? 1;
  const yPct = (cost: number) => (1 - cost / yMax) * 100;

  const ticks = timeTicks(timeline.domain);
  const multiDay = isMultiDay(timeline.extent);
  const plot: ScrubPlot = {
    domain: timeline.domain,
    extent: timeline.extent,
    width: plotWidth,
  };

  const steps = timeline.cumulative;
  const { line, area } = stepCurvePath(steps, timeline.domain, yMax);
  const last = steps[steps.length - 1];

  const readout = readoutX != null && plotWidth > 0 ? readoutAt(timeline, plot, readoutX) : null;
  const dot = readout
    ? readoutDot(timeline, readout, plot)
    : lastStepDot(timeline, plot);

  const day = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric" }),
    [locale],
  );
  const hour = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false }),
    [locale],
  );
  const dayHour = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
    [locale],
  );
  const tickLabel = (tick: (typeof ticks)[number]) =>
    tick.kind === "day" ? day.format(tick.t) : hour.format(tick.t);

  // Tapping anywhere on the plot moves the crosshair there; dragging keeps it
  // under the finger. `locationX` is relative to the plot, which is exactly
  // what the pixel→time math wants.
  const onTouch = (event: GestureResponderEvent) => {
    const x = event.nativeEvent.locationX;
    setReadoutX(Math.min(Math.max(x, 0), plotWidthRef.current));
  };

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={t("runsTimeline.chartAria", {
        count: timeline.runs.length,
        cost: formatUsd(timeline.totalCost),
      })}
      className="gap-2 rounded-lg border border-border bg-card p-3"
    >
      {/* Legend */}
      <View className="flex-row flex-wrap items-center gap-x-4 gap-y-1">
        {pricing ? (
          <View className="flex-row items-center gap-1.5">
            <View
              className="h-0.5 w-3.5 rounded-full"
              style={{ backgroundColor: theme.chart1 }}
            />
            <Text className="text-micro text-muted-foreground">
              {t("runsTimeline.legendCumulative")}
            </Text>
          </View>
        ) : null}
        <View className="flex-row items-center gap-1.5">
          <View
            className="h-2 w-3 rounded-sm"
            style={{ backgroundColor: theme.chart2 }}
          />
          <Text className="text-micro text-muted-foreground">
            {t("runsTimeline.legendRun")}
          </Text>
        </View>
      </View>

      {/* The plot: lane labels, then the scrub surface — the curve box and the
          lane rows, which share one time axis. The touch handler sits on that
          surface ALONE, so `locationX` is measured from the axis' own left
          edge; spanning the label column too would shift every reading by its
          width. */}
      <View className="flex-row">
        {/* Lane labels, aligned with the lanes in the plot column. Decorative:
            they repeat what each row's runs already say, and the day list
            below is the chart's accessible view. */}
        <View
          style={{ width: LANE_LABEL_WIDTH }}
          className="shrink-0"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {plotHeight > 0 ? <View style={{ height: plotHeight }} /> : null}
          <View style={{ marginTop: plotHeight > 0 ? 9 : 0 }}>
            {timeline.lanes.map((lane) => (
              <View
                key={lane.agentId}
                style={{ height: LANE_HEIGHT, marginBottom: LANE_GAP }}
                className="flex-row items-center gap-1.5"
              >
                <ActorAvatar type="agent" id={lane.agentId} size={14} />
                <Text className="flex-1 text-micro text-muted-foreground" numberOfLines={1}>
                  {getName("agent", lane.agentId)}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View
          className="min-w-0 flex-1"
          onLayout={(e: LayoutChangeEvent) => {
            const w = e.nativeEvent.layout.width;
            plotWidthRef.current = w;
            setPlotWidth(w);
          }}
          onTouchStart={onTouch}
          onTouchMove={onTouch}
          onTouchEnd={() => setReadoutX(null)}
        >
          {/* Gridlines run through the curve and the lanes alike. */}
          <View>
            {ticks.map((tick) => (
              <View
                key={tick.t}
                className="absolute top-0 bottom-0 w-px bg-border"
                style={{ left: `${xPctAt(tick.t, plot)}%` }}
              />
            ))}

            {plotHeight > 0 ? (
              <View style={{ height: plotHeight }}>
                {yTicks.map((v) => (
                  <View
                    key={v}
                    className="absolute left-0 right-0 h-px bg-border"
                    style={{ top: `${yPct(v)}%` }}
                  />
                ))}
                {steps.length > 0 ? (
                  <Svg
                    width="100%"
                    height="100%"
                    viewBox="0 0 1000 100"
                    preserveAspectRatio="none"
                    style={{ position: "absolute", left: 0, top: 0 }}
                  >
                    <Path d={area} fill={theme.chart1} fillOpacity={0.1} />
                    <Path
                      d={line}
                      fill="none"
                      stroke={theme.chart1}
                      strokeWidth={2}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </Svg>
                ) : null}
                {dot ? (
                  <View
                    className="absolute rounded-full"
                    style={{
                      left: `${dot.xPct}%`,
                      top: `${yPct(dot.cost)}%`,
                      width: 8,
                      height: 8,
                      marginLeft: -4,
                      marginTop: -4,
                      backgroundColor: theme.chart1,
                    }}
                  />
                ) : null}
              </View>
            ) : null}

            {/* Rows, not tracks, carry the lane's runs, and they touch: moving
                from one lane to the next never crosses a gap belonging to no
                lane. */}
            <View style={{ marginTop: plotHeight > 0 ? 9 : 0 }}>
              {timeline.lanes.map((lane) => (
                <View
                  key={lane.agentId}
                  style={{ height: LANE_HEIGHT, marginBottom: LANE_GAP }}
                  className="justify-center"
                >
                  <View className="relative h-3.5 flex-1 rounded-sm bg-muted">
                    {lane.runs.map((run) => (
                      <View
                        key={run.task.id}
                        className="absolute top-0.5 bottom-0.5 rounded-sm"
                        style={{
                          left: `${xPctAt(run.startMs, plot)}%`,
                          width: `${Math.max(xPctAt(run.endMs, plot) - xPctAt(run.startMs, plot), 0.6)}%`,
                          backgroundColor: runBarColor(run, run === timeline.peak, theme),
                        }}
                      />
                    ))}
                  </View>
                </View>
              ))}
            </View>

            {readout ? (
              <View
                className="absolute top-0 bottom-0 w-px bg-foreground/40"
                style={{ left: `${readout.xPct}%` }}
              />
            ) : null}
          </View>

          {/* Time axis */}
          <View className="relative mt-1 h-4">
            {ticks.map((tick) => {
              const x = xPctAt(tick.t, plot);
              // The pointer's own time tag takes the axis where it stands.
              if (readout && Math.abs(((x - readout.xPct) / 100) * plotWidth) < 44) return null;
              return (
                <Text
                  key={tick.t}
                  className="absolute text-micro text-muted-foreground"
                  numberOfLines={1}
                  style={{
                    left: `${x}%`,
                    maxWidth: 80,
                    transform: x > 85 ? [{ translateX: -70 }] : undefined,
                  }}
                >
                  {tickLabel(tick)}
                </Text>
              );
            })}
            {readout ? (
              <View
                className="absolute -top-0.5 rounded-sm bg-foreground px-1"
                style={{
                  left: `${readout.xPct}%`,
                  transform: readout.xPct < 15
                    ? undefined
                    : readout.xPct > 85
                      ? [{ translateX: -48 }]
                      : [{ translateX: -24 }],
                }}
              >
                <Text className="text-micro font-medium tabular-nums text-background">
                  {multiDay ? dayHour.format(readout.t) : hour.format(readout.t)}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Y scale on the right, where the curve ends; the end value is the
            one figure labelled in full. */}
        {plotHeight > 0 ? (
          <View style={{ width: Y_AXIS_WIDTH, height: plotHeight }} className="shrink-0">
            {yTicks.map((v) =>
              last && Math.abs(yPct(v) - yPct(last.cost)) < 12 ? null : (
                <Text
                  key={v}
                  className="absolute left-1 text-micro tabular-nums text-muted-foreground"
                  numberOfLines={1}
                  style={{ top: `${yPct(v)}%`, marginTop: -7 }}
                >
                  {formatTick(v)}
                </Text>
              ),
            )}
            {last ? (
              <Text
                className="absolute left-1 text-micro font-medium tabular-nums text-foreground"
                numberOfLines={1}
                style={{ top: `${yPct(last.cost)}%`, marginTop: -7 }}
              >
                {formatUsd(last.cost)}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      {/* Readout. Web floats this beside the crosshair; at phone width the card
          would cover the curve it describes, so it gets its own row and the
          numbers hold still while the finger moves. */}
      <View className="min-h-[38px] justify-center rounded-md bg-secondary/60 px-2 py-1.5">
        {readout ? (
          readout.run ? (
            <RunReadout run={readout.run} />
          ) : (
            <IdleReadout
              fromMs={readout.idle.fromMs}
              toMs={readout.idle.toMs}
              total={timeline.pricedCount > 0 ? readout.totalSoFar : null}
            />
          )
        ) : (
          <Text className="text-micro text-muted-foreground">
            {pricing ? t("runsTimeline.scrubHint") : t("runsTimeline.sparklineNoUsage")}
          </Text>
        )}
      </View>
    </View>
  );
}

/** The run bar's colour: active pulses blue, failures red, cancellations grey,
 *  the peak takes the curve's colour, everything else the run colour. */
function runBarColor(
  run: TimelineRun,
  isPeak: boolean,
  theme: (typeof THEME)["light"],
): string {
  if (run.active) return theme.info;
  if (run.task.status === "failed") return theme.destructive;
  if (run.task.status === "cancelled") return theme.mutedForeground;
  return isPeak ? theme.chart1 : theme.chart2;
}

function RunReadout({ run }: { run: TimelineRun }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const { getName } = useActorLookup();
  const when = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(run.startMs);
  const status = t(`enum.taskStatus.${run.task.status}`);
  const facts = [
    when,
    run.task.status === "completed" && run.durationMs != null
      ? formatDuration(run.durationMs / 1000, UNDER_A_SECOND)
      : status,
  ];
  return (
    <View className="gap-0.5">
      <Text className="text-caption font-medium text-foreground" numberOfLines={1}>
        {runSummary(run, t)}
      </Text>
      <View className="flex-row items-center gap-1.5">
        <ActorAvatar type="agent" id={run.task.agent_id} size={12} />
        <Text className="flex-1 text-micro text-muted-foreground" numberOfLines={1}>
          {[getName("agent", run.task.agent_id), ...facts].join(" · ")}
        </Text>
      </View>
      <Text className="text-micro tabular-nums">
        <Text className="font-medium text-foreground">
          {run.usage ? formatUsd(run.usage.cost) : t("runsTimeline.noUsage")}
        </Text>
        <Text className="text-muted-foreground">
          {" · "}
          {t("runsTimeline.tooltipTotal", { cost: formatUsd(run.costSoFar) })}
        </Text>
      </Text>
    </View>
  );
}

/** Between runs: nothing ran here, with how long the quiet lasted and what the
 *  issue had spent by then. */
function IdleReadout({
  fromMs,
  toMs,
  total,
}: {
  fromMs: number | null;
  toMs: number | null;
  total: number | null;
}) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const span = useMemo(() => {
    if (fromMs == null || toMs == null) return null;
    const sameDay = new Date(fromMs).toDateString() === new Date(toMs).toDateString();
    const fmt = new Intl.DateTimeFormat(locale, {
      ...(sameDay ? {} : { month: "short", day: "numeric" }),
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return `${fmt.format(fromMs)} → ${fmt.format(toMs)}`;
  }, [fromMs, toMs, locale]);

  return (
    <View className="gap-0.5">
      <Text className="text-caption font-medium text-foreground">
        {t("runsTimeline.hoverNoRun")}
      </Text>
      {span && fromMs != null && toMs != null ? (
        <Text className="text-micro tabular-nums text-muted-foreground" numberOfLines={1}>
          {span} ·{" "}
          {t("runsTimeline.hoverIdle", {
            duration: formatDuration((toMs - fromMs) / 1000, UNDER_A_SECOND),
          })}
        </Text>
      ) : null}
      {total != null ? (
        <Text className="text-micro tabular-nums text-muted-foreground">
          {t("runsTimeline.tooltipTotal", { cost: formatUsd(total) })}
        </Text>
      ) : null}
    </View>
  );
}

// ─── Day list ──────────────────────────────────────────────────────────────

function RunDayList({ timeline }: { timeline: RunTimeline }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const groups = useMemo(() => groupRunsByDay(timeline.runs), [timeline.runs]);
  // "Today" / "Yesterday" are sampled once per render of this list, not on a
  // ticker: the sheet is short-lived and a day boundary crossed mid-session
  // re-renders on the next task update anyway.
  const nowMs = Date.now();

  const dayLabel = (dayMs: number) => {
    const kind: DayLabelKind = dayLabelKind(dayMs, nowMs);
    if (kind === "today") return t("runsTimeline.dayToday");
    if (kind === "yesterday") return t("runsTimeline.dayYesterday");
    return new Intl.DateTimeFormat(locale, {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(dayMs);
  };

  return (
    <View>
      {groups.map((group) => (
        <View key={group.dayMs}>
          <View className="flex-row items-baseline gap-2 border-b border-border pb-1 pt-3">
            <Text className="text-micro font-medium uppercase tracking-wider text-foreground">
              {dayLabel(group.dayMs)}
            </Text>
            <Text className="ml-auto text-micro tabular-nums text-muted-foreground">
              {[
                t("runsTimeline.dayRuns", { count: group.runs.length }),
                group.agentMs > 0
                  ? formatDuration(group.agentMs / 1000, UNDER_A_SECOND)
                  : null,
                group.runs.some((r) => r.usage) ? formatUsd(group.cost) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </View>
          {group.runs.map((run) => (
            <RunListRow key={run.task.id} run={run} />
          ))}
        </View>
      ))}
    </View>
  );
}

function RunListRow({ run }: { run: TimelineRun }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const { getName } = useActorLookup();
  const task = run.task;
  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(run.startMs);
  const statusLabel = t(`enum.taskStatus.${task.status}`);

  return (
    <View className="flex-row items-center gap-2 border-b border-border/60 py-2">
      <Text className="w-10 shrink-0 text-micro font-medium tabular-nums text-muted-foreground">
        {time}
      </Text>
      <View className="min-w-0 flex-1">
        <Text
          className={
            run.usage || run.active
              ? "text-label text-foreground"
              : "text-label text-muted-foreground"
          }
          numberOfLines={1}
        >
          {runSummary(run, t)}
        </Text>
        <View className="flex-row items-center gap-1.5">
          <ActorAvatar type="agent" id={task.agent_id} size={12} />
          <Text className="flex-1 text-micro text-muted-foreground" numberOfLines={1}>
            {getName("agent", task.agent_id)}
          </Text>
          <Text className={`text-micro ${STATUS_CLASS[task.status]}`} numberOfLines={1}>
            {run.active
              ? statusLabel
              : task.status === "completed" && run.durationMs != null
                ? formatDuration(run.durationMs / 1000, UNDER_A_SECOND)
                : statusLabel}
          </Text>
        </View>
      </View>
      <Text className="shrink-0 text-caption font-medium tabular-nums text-foreground">
        {run.usage ? formatUsd(run.usage.cost) : "—"}
      </Text>
    </View>
  );
}

function runSummary(run: TimelineRun, t: (id: string, params?: Record<string, string | number>) => string): string {
  const task = run.task;
  if (task.handoff_note) return task.handoff_note;
  if (task.trigger_summary) {
    // Comment-triggered runs quote what the person said; structural triggers
    // are plain labels.
    if (task.trigger_comment_id && !task.wakeup_id) {
      return t("runsTimeline.quoted", { text: task.trigger_summary });
    }
    return task.trigger_summary;
  }
  switch (task.kind) {
    case "comment":
      return t("runs.kind.comment");
    case "autopilot":
      return t("runs.kind.autopilot");
    case "chat":
      return t("runs.kind.chat");
    case "quick_create":
      return t("runs.kind.quickCreate");
    default:
      return t("runs.kind.task");
  }
}

const STATUS_CLASS: Record<AgentTask["status"], string> = {
  queued: "text-muted-foreground",
  dispatched: "text-brand",
  waiting_local_directory: "text-muted-foreground",
  running: "text-brand",
  completed: "text-muted-foreground",
  failed: "text-destructive",
  cancelled: "text-muted-foreground",
};
