import { describe, expect, it } from "vitest";
import { DASHBOARD_KEY_RANGE_INDEX, isSameDashboardScope } from "./usage-scope";

// The exact shape apps/mobile/data/queries/usage.ts builds:
// ["dashboard", <report>, wsId, days, projectId, tz]
const key = (
  report: string,
  wsId: string,
  days: number,
  projectId: string | null,
  tz: string,
) => ["dashboard", report, wsId, days, projectId, tz] as const;

describe("isSameDashboardScope", () => {
  it("treats a range change as the same scope", () => {
    const prev = key("usage-daily", "ws-1", 30, null, "Asia/Shanghai");
    const next = key("usage-daily", "ws-1", 7, null, "Asia/Shanghai");
    expect(isSameDashboardScope(prev, next)).toBe(true);
  });

  // Web parity: the whole point is that switching 7d/30d keeps the cards
  // mounted. Both directions must hold, or the transition only works one way.
  it("holds in both directions", () => {
    const wide = key("usage-daily", "ws-1", 30, null, "Asia/Shanghai");
    const narrow = key("usage-daily", "ws-1", 7, null, "Asia/Shanghai");
    expect(isSameDashboardScope(narrow, wide)).toBe(true);
  });

  it("is the same scope when nothing changed at all", () => {
    const k = key("usage-daily", "ws-1", 30, null, "Asia/Shanghai");
    expect(isSameDashboardScope(k, k)).toBe(true);
  });

  it("rejects a workspace change", () => {
    const prev = key("usage-daily", "ws-1", 30, null, "Asia/Shanghai");
    const next = key("usage-daily", "ws-2", 30, null, "Asia/Shanghai");
    expect(isSameDashboardScope(prev, next)).toBe(false);
  });

  it("rejects a project change", () => {
    const prev = key("usage-daily", "ws-1", 30, null, "Asia/Shanghai");
    const next = key("usage-daily", "ws-1", 30, "proj-1", "Asia/Shanghai");
    expect(isSameDashboardScope(prev, next)).toBe(false);
  });

  // The tz is what the server slices every day bucket on, so carrying buckets
  // across a zone change would relabel one zone's numbers as another's.
  it("rejects a timezone change", () => {
    const prev = key("usage-daily", "ws-1", 30, null, "Asia/Shanghai");
    const next = key("usage-daily", "ws-1", 30, null, "America/New_York");
    expect(isSameDashboardScope(prev, next)).toBe(false);
  });

  it("rejects a report change", () => {
    const prev = key("usage-daily", "ws-1", 30, null, "Asia/Shanghai");
    const next = key("failures-daily", "ws-1", 30, null, "Asia/Shanghai");
    expect(isSameDashboardScope(prev, next)).toBe(false);
  });

  it("rejects a project change made together with a range change", () => {
    const prev = key("usage-daily", "ws-1", 30, null, "Asia/Shanghai");
    const next = key("usage-daily", "ws-1", 7, "proj-1", "Asia/Shanghai");
    expect(isSameDashboardScope(prev, next)).toBe(false);
  });

  it("rejects a missing previous key", () => {
    const next = key("usage-daily", "ws-1", 30, null, "Asia/Shanghai");
    expect(isSameDashboardScope(undefined, next)).toBe(false);
  });

  it("rejects a key of a different length", () => {
    const prev = ["dashboard", "usage-daily", "ws-1", 30] as const;
    const next = key("usage-daily", "ws-1", 30, null, "Asia/Shanghai");
    expect(isSameDashboardScope(prev, next)).toBe(false);
  });

  // Guards the layout assumption above: if the keys ever gain a leading
  // segment, this index has to move with them or the guard starts comparing
  // the wrong field.
  it("pins the range index every dashboard key uses", () => {
    const k = key("usage-daily", "ws-1", 30, null, "Asia/Shanghai");
    expect(k[DASHBOARD_KEY_RANGE_INDEX]).toBe(30);
  });
});
