import { describe, expect, it } from "vitest";
import type { Issue } from "@multica/core/types";
import {
  DAY_PX_BY_ZOOM,
  daysBetween,
  ganttBarGeometry,
  ganttCanvasRows,
  ganttInverted,
  computeGanttRange,
  utcDay,
} from "./gantt";

function utc(s: string): Date {
  return utcDay(s)!;
}

function issue(over: Partial<Issue>): Issue {
  return {
    id: "i1",
    number: 1,
    identifier: "WS-1",
    title: "Issue 1",
    status: "todo",
    priority: "medium",
    position: 0,
    start_date: null,
    due_date: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  } as Issue;
}

describe("utcDay", () => {
  it("anchors a date-only string at UTC midnight", () => {
    const d = utcDay("2026-03-05")!;
    expect(d.toISOString()).toBe("2026-03-05T00:00:00.000Z");
  });

  it("reads a full ISO timestamp as its UTC calendar day", () => {
    const d = utcDay("2026-03-05T23:30:00.000Z")!;
    expect(d.toISOString()).toBe("2026-03-05T00:00:00.000Z");
  });

  it("returns null for empty or garbage", () => {
    expect(utcDay(null)).toBeNull();
    expect(utcDay("")).toBeNull();
    expect(utcDay("not-a-date")).toBeNull();
  });
});

describe("daysBetween", () => {
  it("counts whole UTC days", () => {
    expect(daysBetween(utc("2026-03-01"), utc("2026-03-10"))).toBe(9);
    expect(daysBetween(utc("2026-03-10"), utc("2026-03-01"))).toBe(-9);
  });
});

describe("ganttInverted", () => {
  it("flags start after due", () => {
    expect(ganttInverted("2026-03-10", "2026-03-01")).toBe(true);
    expect(ganttInverted("2026-03-01", "2026-03-10")).toBe(false);
    expect(ganttInverted("2026-03-01", null)).toBe(false);
    expect(ganttInverted(null, null)).toBe(false);
  });
});

describe("computeGanttRange", () => {
  it("centers on today with the zoom's default pad when no issues", () => {
    const today = utc("2026-09-11");
    const range = computeGanttRange([], today, "week");
    // week default pad is 60 days, clamped to a +2..pad+1 margin.
    expect(range.start.toISOString()).toBe("2026-07-03T00:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-11-21T00:00:00.000Z");
  });

  it("expands to cover issue dates outside the padded window", () => {
    const today = utc("2026-09-11");
    const range = computeGanttRange(
      [issue({ start_date: "2026-01-01", due_date: "2027-06-01" })],
      today,
      "week",
    );
    expect(daysBetween(range.start, utc("2026-01-01"))).toBeGreaterThanOrEqual(2);
    expect(daysBetween(utc("2027-06-01"), range.end)).toBeGreaterThanOrEqual(2);
  });

  it("includes a lone start_date beyond today", () => {
    const today = utc("2026-09-11");
    const range = computeGanttRange(
      [issue({ start_date: "2027-01-15", due_date: null })],
      today,
      "day",
    );
    expect(daysBetween(utc("2027-01-15"), range.end)).toBeGreaterThanOrEqual(2);
  });

  it("includes an inverted issue's due_date (the min end) in the window", () => {
    const today = utc("2026-09-11");
    const range = computeGanttRange(
      [issue({ start_date: "2026-10-01", due_date: "2026-05-01" })],
      today,
      "week",
    );
    expect(daysBetween(range.start, utc("2026-05-01"))).toBeGreaterThanOrEqual(2);
  });
});

describe("ganttBarGeometry", () => {
  const range = { start: utc("2026-09-01"), end: utc("2026-10-01") };
  const totalDays = daysBetween(range.start, range.end);

  it("spans start..due inclusive of the due day", () => {
    const bar = ganttBarGeometry({
      start: utc("2026-09-05"),
      due: utc("2026-09-09"),
      range,
      totalDays,
      dayPx: 14,
    });
    expect(bar).not.toBeNull();
    expect(bar!.left).toBe(4 * 14);
    expect(bar!.width).toBe(5 * 14);
    expect(bar!.isMarker).toBe(false);
  });

  it("clamps bars that start before the range", () => {
    const bar = ganttBarGeometry({
      start: utc("2026-08-20"),
      due: utc("2026-09-03"),
      range,
      totalDays,
      dayPx: 14,
    });
    expect(bar!.left).toBe(0);
    expect(bar!.width).toBe(3 * 14);
  });

  it("clamps bars that end past the range", () => {
    const bar = ganttBarGeometry({
      start: utc("2026-09-28"),
      due: utc("2026-10-15"),
      range,
      totalDays,
      dayPx: 14,
    });
    // Sep 28..Sep 30 → 3 days.
    expect(bar!.width).toBe(3 * 14);
  });

  it("renders a diamond marker for a single date (due only)", () => {
    const bar = ganttBarGeometry({
      start: null,
      due: utc("2026-09-05"),
      range,
      totalDays,
      dayPx: 14,
    });
    expect(bar!.isMarker).toBe(true);
    expect(bar!.left).toBe(4 * 14);
  });

  it("renders a diamond marker for a single date (start only)", () => {
    const bar = ganttBarGeometry({
      start: utc("2026-09-05"),
      due: null,
      range,
      totalDays,
      dayPx: 14,
    });
    expect(bar!.isMarker).toBe(true);
  });

  it("normalizes inverted dates to min..max", () => {
    const bar = ganttBarGeometry({
      start: utc("2026-09-09"),
      due: utc("2026-09-05"),
      range,
      totalDays,
      dayPx: 14,
    });
    expect(bar!.left).toBe(4 * 14);
    expect(bar!.width).toBe(5 * 14);
  });

  it("returns null when the bar falls entirely outside the range", () => {
    expect(
      ganttBarGeometry({
        start: utc("2026-10-05"),
        due: utc("2026-10-09"),
        range,
        totalDays,
        dayPx: 14,
      }),
    ).toBeNull();
  });
});

describe("ganttCanvasRows", () => {
  const rows = [
    issue({ id: "dated-open", start_date: "2026-03-01" }),
    issue({ id: "dated-done", start_date: "2026-03-01", status: "done" }),
    issue({ id: "dated-cancelled", due_date: "2026-03-01", status: "cancelled" }),
    issue({ id: "undated", status: "todo" }),
  ];

  it("drops undated rows always (defensive: server sends scheduled=true)", () => {
    expect(ganttCanvasRows(rows, true).map((r) => r.id)).not.toContain("undated");
    expect(ganttCanvasRows(rows, false).map((r) => r.id)).not.toContain("undated");
  });

  it("keeps done/cancelled only when showCompleted", () => {
    const shown = ganttCanvasRows(rows, true).map((r) => r.id);
    expect(shown).toContain("dated-done");
    expect(shown).toContain("dated-cancelled");

    const hidden = ganttCanvasRows(rows, false).map((r) => r.id);
    expect(hidden).not.toContain("dated-done");
    expect(hidden).not.toContain("dated-cancelled");
    expect(hidden).toContain("dated-open");
  });
});

describe("DAY_PX_BY_ZOOM", () => {
  it("matches web's three zoom tiers", () => {
    expect(DAY_PX_BY_ZOOM).toEqual({ day: 36, week: 14, month: 6 });
  });
});
