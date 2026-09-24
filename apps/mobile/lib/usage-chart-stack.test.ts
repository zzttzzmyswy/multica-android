import { describe, expect, it } from "vitest";
import {
  isStackedTrend,
  trendLegendSegments,
  trendStackSegments,
} from "./usage-chart-stack";

describe("trendStackSegments", () => {
  // Web stacks the token trend bottom-up input → output → cacheRead →
  // cacheWrite. Cache write sits on top because it is the smallest and the
  // only one that gets a rounded cap.
  it("stacks tokens as input / output / cacheRead / cacheWrite", () => {
    expect(trendStackSegments("tokens").map((s) => s.key)).toEqual([
      "input",
      "output",
      "cacheRead",
      "cacheWrite",
    ]);
  });

  // The asymmetry is the point: cache reads dominate a raw token count but are
  // invisible in dollars. Dropping the wrong one either hides the shape of
  // usage or draws a sub-pixel segment.
  it("stacks cost without cacheRead", () => {
    expect(trendStackSegments("cost").map((s) => s.key)).toEqual([
      "input",
      "output",
      "cacheWrite",
    ]);
  });

  it("keeps cacheWrite last in both stacks so the rounded cap lands on it", () => {
    expect(trendStackSegments("tokens").at(-1)?.key).toBe("cacheWrite");
    expect(trendStackSegments("cost").at(-1)?.key).toBe("cacheWrite");
  });

  it("has no stack for the single-series metrics", () => {
    expect(trendStackSegments("time")).toEqual([]);
    expect(trendStackSegments("tasks")).toEqual([]);
  });

  it("has no stack for an unknown metric", () => {
    expect(trendStackSegments("nonsense")).toEqual([]);
  });
});

describe("chart colour tokens", () => {
  // Web's series → CSS chart token mapping. Cache read takes chart-4 rather
  // than chart-3 so it is tonally distinct from input/output while staying
  // adjacent to cache write.
  it("maps each series to web's chart token", () => {
    const tokens = trendStackSegments("tokens");
    expect(tokens.find((s) => s.key === "input")?.chartToken).toBe(1);
    expect(tokens.find((s) => s.key === "output")?.chartToken).toBe(2);
    expect(tokens.find((s) => s.key === "cacheRead")?.chartToken).toBe(4);
    expect(tokens.find((s) => s.key === "cacheWrite")?.chartToken).toBe(3);
  });

  it("gives a series the same colour in both stacks", () => {
    const inTokens = trendStackSegments("tokens");
    const inCost = trendStackSegments("cost");
    for (const seg of inCost) {
      expect(inTokens.find((s) => s.key === seg.key)?.chartToken).toBe(seg.chartToken);
    }
  });
});

describe("isStackedTrend", () => {
  it("marks the metrics web draws as stacks", () => {
    expect(isStackedTrend("tokens")).toBe(true);
    expect(isStackedTrend("cost")).toBe(true);
  });

  it("leaves the single-series metrics alone", () => {
    expect(isStackedTrend("time")).toBe(false);
    expect(isStackedTrend("tasks")).toBe(false);
  });
});

describe("trendLegendSegments", () => {
  // A legend that disagrees with the stack is worse than none: it names
  // colours that are not on screen.
  it("matches the stack order for every stacked metric", () => {
    for (const metric of ["tokens", "cost"]) {
      expect(trendLegendSegments(metric)).toEqual(trendStackSegments(metric));
    }
  });

  it("renders no legend for the unstacked metrics", () => {
    expect(trendLegendSegments("time")).toEqual([]);
    expect(trendLegendSegments("tasks")).toEqual([]);
  });
});
