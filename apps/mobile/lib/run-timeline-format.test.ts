import { describe, expect, it } from "vitest";
import type { AgentTask } from "@multica/core/types";
import { buildRunTimeline } from "./issue-run-timeline";
import {
  axisEndKinds,
  dayLabelKind,
  isMultiDay,
  localDayStart,
} from "./run-timeline-format";

/**
 * Label rules for the run timeline (MYS-2084). These are the two places where a
 * wrong answer is invisible in a screenshot: a day group labelled with the UTC
 * day instead of the reader's, and an axis that says "Now" when nothing is
 * running (or a clock time when the issue is three days old).
 */

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: "task-1",
    agent_id: "agent-1",
    runtime_id: "runtime-1",
    issue_id: "issue-1",
    status: "completed",
    priority: 0,
    dispatched_at: null,
    started_at: "2026-09-24T10:00:00",
    completed_at: "2026-09-24T10:30:00",
    result: null,
    error: null,
    created_at: "2026-09-24T09:59:00",
    ...overrides,
  };
}

describe("localDayStart", () => {
  it("floors to the reader's local midnight", () => {
    const d = new Date(localDayStart(new Date("2026-09-24T23:30:00").getTime()));
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
    expect(d.getDate()).toBe(24);
  });
});

describe("dayLabelKind", () => {
  const now = new Date("2026-09-25T09:00:00").getTime();

  it("names today and yesterday, and dates anything older", () => {
    expect(dayLabelKind(localDayStart(new Date("2026-09-25T01:00:00").getTime()), now)).toBe("today");
    expect(dayLabelKind(localDayStart(new Date("2026-09-24T23:59:00").getTime()), now)).toBe("yesterday");
    expect(dayLabelKind(localDayStart(new Date("2026-09-23T12:00:00").getTime()), now)).toBe("date");
  });

  it("crosses a DST boundary by calendar day, not by 24-hour arithmetic", () => {
    // The day before a spring-forward is 23 hours long. This asserts the rule
    // that matters wherever DST applies: `today - 86_400_000` is not how the
    // previous calendar day is found. (In a fixed-offset zone the two agree,
    // which is exactly why the calendar form has to be the one in the code.)
    const dstNow = new Date("2026-03-09T12:00:00").getTime();
    const previousDay = new Date(dstNow);
    previousDay.setDate(previousDay.getDate() - 1);
    previousDay.setHours(0, 0, 0, 0);
    expect(dayLabelKind(previousDay.getTime(), dstNow)).toBe("yesterday");
    expect(dayLabelKind(localDayStart(dstNow), dstNow)).toBe("today");
  });

  it("does not call a run from today 'Yesterday' just before local midnight", () => {
    const late = new Date("2026-09-25T23:59:00").getTime();
    expect(dayLabelKind(localDayStart(late), late)).toBe("today");
  });
});

describe("axisEndKinds", () => {
  const now = new Date("2026-09-25T09:00:00").getTime();

  it("reads clock times on both ends while the issue is today's", () => {
    const extent: [number, number] = [
      new Date("2026-09-25T08:00:00").getTime(),
      new Date("2026-09-25T08:45:00").getTime(),
    ];
    expect(axisEndKinds(extent, 0, now)).toEqual({ start: "clock", end: "clock" });
  });

  it("says 'Now' at the right end while a run is still going", () => {
    const extent: [number, number] = [
      new Date("2026-09-24T08:00:00").getTime(),
      now,
    ];
    expect(axisEndKinds(extent, 1, now).end).toBe("now");
  });

  it("names the day once the axis leaves today, and 'Today' when it lands on it", () => {
    const spansToToday: [number, number] = [
      new Date("2026-09-23T08:00:00").getTime(),
      new Date("2026-09-25T08:00:00").getTime(),
    ];
    expect(axisEndKinds(spansToToday, 0, now)).toEqual({ start: "day", end: "today" });

    const olderIssue: [number, number] = [
      new Date("2026-09-20T08:00:00").getTime(),
      new Date("2026-09-21T08:00:00").getTime(),
    ];
    expect(axisEndKinds(olderIssue, 0, now)).toEqual({ start: "day", end: "day" });
  });
});

describe("isMultiDay", () => {
  it("switches grain past a day and a half, matching timeTicks", () => {
    const h = 60 * 60 * 1000;
    const base = new Date("2026-09-24T00:00:00").getTime();
    expect(isMultiDay([base, base + 5 * h])).toBe(false);
    expect(isMultiDay([base, base + 40 * h])).toBe(true);
  });
});

describe("timeline extents feeding the axis labels", () => {
  it("uses the run-bearing stretch, not the padded domain", () => {
    const timeline = buildRunTimeline(
      [
        makeTask({
          started_at: "2026-09-25T08:00:00",
          completed_at: "2026-09-25T08:45:00",
        }),
      ],
      new Date("2026-09-25T09:00:00").getTime(),
    );
    // The padded domain is wider than the runs, so labelling the domain would
    // print a clock time hours before anything happened.
    expect(timeline.extent).toEqual([
      new Date("2026-09-25T08:00:00").getTime(),
      new Date("2026-09-25T08:45:00").getTime(),
    ]);
    expect(timeline.domain[0]).toBeLessThan(timeline.extent[0]);
    expect(timeline.domain[1]).toBeGreaterThan(timeline.extent[1]);
  });
});
