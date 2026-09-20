/**
 * Stacked-segment order and legend items for the usage trend charts
 * (iteration 171).
 *
 * Web draws the token trend as a four-segment stack and the cost trend as a
 * three-segment one, bottom-up, and the difference between them is deliberate:
 *
 *  - Tokens keep cache reads *in*. A typical day shows cache reads dominating
 *    the raw token count (often 10×+ input), so the real shape of usage only
 *    appears once reads are stacked in
 *    (packages/views/runtimes/components/charts/daily-tokens-chart.tsx:17-27).
 *  - Cost drops cache reads for the opposite reason: their dollar contribution
 *    is two orders of magnitude smaller, so the segment would be sub-pixel
 *    (packages/views/runtimes/components/charts/daily-cost-chart.tsx).
 *
 * Colour tokens are web's series → CSS chart token mapping: input → chart-1,
 * output → chart-2, cacheRead → chart-4, cacheWrite → chart-3. Cache read takes
 * chart-4 rather than chart-3 so the two cache series stay tonally distinct
 * from input/output while remaining adjacent to each other.
 *
 * Pure and React-free so the Node-only vitest lane can pin it.
 */

/** Token fields a stacked trend segment can read off a row. */
export type StackSegmentKey = "input" | "output" | "cacheRead" | "cacheWrite";

/** A series in a stacked bar, in bottom-up render order. */
export interface StackSegment {
  /** Field on the row this segment reads. */
  key: StackSegmentKey;
  /** Chart colour token index (1-based), as web numbers them. */
  chartToken: 1 | 2 | 3 | 4;
}

const INPUT: StackSegment = { key: "input", chartToken: 1 };
const OUTPUT: StackSegment = { key: "output", chartToken: 2 };
const CACHE_READ: StackSegment = { key: "cacheRead", chartToken: 4 };
const CACHE_WRITE: StackSegment = { key: "cacheWrite", chartToken: 3 };

/**
 * Bottom-up stack for a metric. Single-series metrics (time, tasks) return an
 * empty list: they are drawn by their own chart, not by this stack.
 */
export function trendStackSegments(metric: string): StackSegment[] {
  switch (metric) {
    case "tokens":
      return [INPUT, OUTPUT, CACHE_READ, CACHE_WRITE];
    case "cost":
      return [INPUT, OUTPUT, CACHE_WRITE];
    default:
      return [];
  }
}

/** Whether a metric's trend is drawn as a stack (rather than a single bar or
 *  its own bespoke chart). */
export function isStackedTrend(metric: string): boolean {
  return trendStackSegments(metric).length > 0;
}

/** Legend entries for a metric, in the same order as the stack reads bottom-up.
 *  Metrics with no stack have no legend — the chart title already names them,
 *  and a legend naming colours that are not on screen is worse than none. */
export function trendLegendSegments(metric: string): StackSegment[] {
  return trendStackSegments(metric);
}
