/**
 * Scrub math for the run timeline's chart and its spend strip — the mobile
 * stand-in for web's pointer-hover layer in
 * `packages/views/issues/components/issue-runs-dialog.tsx`.
 *
 * Web reads the run under the cursor on `pointermove`; a phone has no hover, so
 * the same question is asked of a finger: a drag across the plot puts a
 * crosshair on a moment, and the readout names the run there (or the quiet
 * stretch between runs). Only the *input* changes — the arithmetic that decides
 * which run answers, and what the curve reads, is the same
 * `runIndexAt` / `cumulativeCostAt` / `idleSpanAround` the web surface uses.
 *
 * Kept pure and separate from the component so the "a few pixels of slop reach
 * a 3px sliver" rule and the clamp to the run-bearing stretch of the axis are
 * testable in the Node lane, where no touch responder can run.
 */
import {
  cumulativeCostAt,
  idleSpanAround,
  runIndexAt,
  type RunTimeline,
  type TimelineRun,
} from "./issue-run-timeline";

/** The plot's rendered geometry: what turns a finger's x into a moment. */
export interface ScrubPlot {
  /** Padded axis bounds (web `timeline.domain`). */
  domain: [number, number];
  /** First start to last end — where a scrub may point (web `timeline.extent`). */
  extent: [number, number];
  /** Rendered width of the plot in pixels. */
  width: number;
}

/**
 * How far a finger can miss a bar and still be on it: a run a few seconds long
 * draws as a 3px sliver, which nobody lands on exactly. Same role as web's
 * `HOVER_SLOP_PX` / `SPARK_SLOP_PX`; slightly larger here because a fingertip
 * is coarser than a cursor.
 */
export const SCRUB_SLOP_PX = 10;

/** The moment at pixel `x` (from the plot's left edge), clamped to `extent`. */
export function timeAtX(x: number, plot: ScrubPlot): number {
  const [d0, d1] = plot.domain;
  const [e0, e1] = plot.extent;
  if (!(plot.width > 0) || !(d1 > d0)) return e0;
  const at = d0 + (x / plot.width) * (d1 - d0);
  return Math.min(Math.max(at, e0), e1);
}

/** Pixel slop converted into the time it covers on this plot. */
export function slopMsFor(plot: ScrubPlot, slopPx: number = SCRUB_SLOP_PX): number {
  const [d0, d1] = plot.domain;
  if (!(plot.width > 0)) return 0;
  return (slopPx / plot.width) * (d1 - d0);
}

/** Where a moment sits across the plot, as a percentage. */
export function xPctAt(t: number, plot: ScrubPlot): number {
  const [d0, d1] = plot.domain;
  if (!(d1 > d0)) return 0;
  return ((t - d0) / (d1 - d0)) * 100;
}

export interface TimelineReadout {
  /** The moment the crosshair stands on. */
  t: number;
  /** The run under it, or null between runs. */
  run: TimelineRun | null;
  /** The curve's reading at `t` — the issue's total once everything that had
   *  finished by then was paid for. */
  totalSoFar: number;
  /** The quiet stretch around `t`; either side null past the first/last run. */
  idle: { fromMs: number | null; toMs: number | null };
  /** Crosshair position across the plot, as a percentage. */
  xPct: number;
}

/**
 * Everything the readout says about the moment under the finger. `agentId`
 * narrows the question to one lane, so scrubbing along an agent's row answers
 * about that agent's runs — never another agent's overlapping one.
 */
export function readoutAt(
  timeline: RunTimeline,
  plot: ScrubPlot,
  x: number,
  slopPx: number = SCRUB_SLOP_PX,
  agentId?: string,
): TimelineReadout {
  const t = timeAtX(x, plot);
  const index = runIndexAt(timeline.runs, t, slopMsFor(plot, slopPx), agentId);
  return {
    t,
    run: index >= 0 ? timeline.runs[index]! : null,
    totalSoFar: cumulativeCostAt(timeline.cumulative, t),
    idle: idleSpanAround(timeline.runs, t, agentId),
    xPct: xPctAt(t, plot),
  };
}

/**
 * The point the readout is about on the curve: the run's own step when there is
 * one (a run that reported no usage has no step to point at), otherwise the
 * curve's reading under the crosshair.
 */
export function readoutDot(
  timeline: RunTimeline,
  readout: TimelineReadout,
  plot: ScrubPlot,
): { xPct: number; cost: number } | null {
  if (readout.run) {
    if (!readout.run.usage) return null;
    return { xPct: xPctAt(readout.run.endMs, plot), cost: readout.run.costSoFar };
  }
  return { xPct: readout.xPct, cost: readout.totalSoFar };
}

/** Where the curve ends — the labelled point when nothing is being scrubbed. */
export function lastStepDot(timeline: RunTimeline, plot: ScrubPlot): { xPct: number; cost: number } | null {
  const last = timeline.cumulative[timeline.cumulative.length - 1];
  return last ? { xPct: xPctAt(last.t, plot), cost: last.cost } : null;
}

/** Axis steps are round numbers; "$50.00" would print noise the curve's end
 *  label, which keeps full precision, does not need (web `formatTick`). */
export function formatTick(v: number): string {
  return Number.isInteger(v) ? `$${v}` : v >= 100 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`;
}
