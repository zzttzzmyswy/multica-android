import { describe, expect, it } from "vitest";
import type { AgentTask, TaskUsage } from "@multica/core/types";
import { buildRunTimeline } from "./issue-run-timeline";
import {
  formatTick,
  lastStepDot,
  readoutAt,
  readoutDot,
  slopMsFor,
  timeAtX,
  xPctAt,
  SCRUB_SLOP_PX,
  type ScrubPlot,
} from "./run-timeline-scrub";

/**
 * Scrub math for the run timeline (MYS-2084) — the mobile replacement for web's
 * pointer-hover layer. These cases pin the two ways a touch chart goes wrong:
 * a finger that cannot reach a 3px sliver, and a readout that reports a run the
 * finger is nowhere near because it snapped to the nearest one.
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

function usage(outputTokens: number): TaskUsage[] {
  return [
    {
      provider: "anthropic",
      model: "claude-opus-5",
      input_tokens: 0,
      output_tokens: outputTokens,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    },
  ];
}

// One hour of axis across 300px: 12s per pixel.
const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-09-24T12:00:00").getTime();
const EXTENT: [number, number] = [
  new Date("2026-09-24T10:00:00").getTime(),
  new Date("2026-09-24T11:00:00").getTime(),
];
const PLOT: ScrubPlot = { domain: EXTENT, extent: EXTENT, width: 300 };

describe("timeAtX", () => {
  it("maps a pixel to a moment across the axis", () => {
    expect(timeAtX(0, PLOT)).toBe(EXTENT[0]);
    expect(timeAtX(300, PLOT)).toBe(EXTENT[1]);
    expect(timeAtX(150, PLOT)).toBe(EXTENT[0] + 30 * 60 * 1000);
  });

  it("clamps to the stretch that holds runs, never past either end", () => {
    expect(timeAtX(-500, PLOT)).toBe(EXTENT[0]);
    expect(timeAtX(9999, PLOT)).toBe(EXTENT[1]);
  });

  it("answers the first moment rather than dividing by zero on a dead plot", () => {
    expect(timeAtX(10, { ...PLOT, width: 0 })).toBe(EXTENT[0]);
    expect(timeAtX(10, { ...PLOT, domain: [5, 5] })).toBe(EXTENT[0]);
  });
});

describe("slopMsFor", () => {
  it("turns the pixel slop into the time a fingertip covers", () => {
    // 10px of 300px over an hour = 2 minutes.
    expect(slopMsFor(PLOT)).toBe((SCRUB_SLOP_PX / 300) * HOUR);
    expect(slopMsFor(PLOT, 30)).toBe((30 / 300) * HOUR);
  });

  it("is zero on a plot with no width", () => {
    expect(slopMsFor({ ...PLOT, width: 0 })).toBe(0);
  });
});

describe("xPctAt", () => {
  it("places a moment across the plot as a percentage", () => {
    expect(xPctAt(EXTENT[0], PLOT)).toBe(0);
    expect(xPctAt(EXTENT[0] + 30 * 60 * 1000, PLOT)).toBe(50);
    expect(xPctAt(EXTENT[1], PLOT)).toBe(100);
  });

  it("does not divide by zero on a zero-width domain", () => {
    expect(xPctAt(1000, { ...PLOT, domain: [1000, 1000] })).toBe(0);
  });
});

describe("readoutAt", () => {
  const timeline = buildRunTimeline(
    [
      makeTask({
        id: "a",
        started_at: "2026-09-24T10:00:00",
        completed_at: "2026-09-24T10:30:00",
        usage: usage(400_000), // $10
      }),
      // 20 seconds long: a 3px sliver at this scale.
      makeTask({
        id: "blip",
        started_at: "2026-09-24T11:00:00",
        completed_at: "2026-09-24T11:00:20",
      }),
    ],
    NOW,
  );

  it("names the run under the finger", () => {
    // 10:15 is halfway along the hour → x = 150.
    expect(readoutAt(timeline, PLOT, 150).run?.task.id).toBe("a");
  });

  it("reaches the sliver within the slop instead of snapping to a far run", () => {
    // 11:00 sits at the right edge; a finger landing 5px short is 60s early,
    // well outside the run but inside the slop.
    const near = readoutAt(timeline, PLOT, 295);
    expect(near.run?.task.id).toBe("blip");
  });

  it("reports no run in the gap rather than reaching across it", () => {
    // 10:45 — 45 minutes past `a`, 15 minutes before `blip`. Nothing is there.
    const gap = readoutAt(timeline, PLOT, 225);
    expect(gap.run).toBeNull();
    // The quiet stretch is reported instead, with the curve's reading.
    expect(gap.idle.fromMs).toBe(new Date("2026-09-24T10:30:00").getTime());
    expect(gap.idle.toMs).toBe(new Date("2026-09-24T11:00:00").getTime());
    expect(gap.totalSoFar).toBe(10);
  });

  it("stays inside one lane when the finger is on that lane's row", () => {
    const overlapping = buildRunTimeline(
      [
        makeTask({
          id: "lambda",
          agent_id: "agent-lambda",
          started_at: "2026-09-24T10:00:00",
          completed_at: "2026-09-24T10:20:00",
        }),
        makeTask({
          id: "emacs",
          agent_id: "agent-emacs",
          started_at: "2026-09-24T10:00:00",
          completed_at: "2026-09-24T10:40:00",
        }),
      ],
      NOW,
    );
    const at = (agentId?: string) => readoutAt(overlapping, PLOT, 90, SCRUB_SLOP_PX, agentId).run?.task.id;
    // The shorter bar wins when both are under the finger (web's rule), and the
    // lane narrows it explicitly.
    expect(at()).toBe("lambda");
    expect(at("agent-emacs")).toBe("emacs");
    expect(at("agent-lambda")).toBe("lambda");
  });

  it("clamps the crosshair to the run-bearing stretch", () => {
    const padded: ScrubPlot = { domain: [EXTENT[0] - HOUR, EXTENT[1] + HOUR], extent: EXTENT, width: 300 };
    expect(readoutAt(timeline, padded, -100).t).toBe(EXTENT[0]);
    expect(readoutAt(timeline, padded, 9999).t).toBe(EXTENT[1]);
  });
});

describe("readoutDot", () => {
  const timeline = buildRunTimeline(
    [
      makeTask({
        id: "a",
        started_at: "2026-09-24T10:00:00",
        completed_at: "2026-09-24T10:30:00",
        usage: usage(400_000), // $10
      }),
      makeTask({
        id: "unpriced",
        started_at: "2026-09-24T10:40:00",
        completed_at: "2026-09-24T10:50:00",
      }),
    ],
    NOW,
  );

  it("points at the run's own step on the curve", () => {
    const dot = readoutDot(timeline, readoutAt(timeline, PLOT, 150), PLOT);
    expect(dot).toEqual({ xPct: 50, cost: 10 });
  });

  it("has nothing to point at for a run that reported no usage", () => {
    // 10:45 → x = 225. The run is there but has no step to point at.
    const readout = readoutAt(timeline, PLOT, 225);
    expect(readout.run?.task.id).toBe("unpriced");
    expect(readoutDot(timeline, readout, PLOT)).toBeNull();
  });

  it("falls back to the curve's reading between runs", () => {
    const timelineWithGap = buildRunTimeline(
      [
        makeTask({
          id: "a",
          started_at: "2026-09-24T10:00:00",
          completed_at: "2026-09-24T10:20:00",
          usage: usage(400_000), // $10
        }),
        makeTask({
          id: "b",
          started_at: "2026-09-24T10:40:00",
          completed_at: "2026-09-24T10:50:00",
          usage: usage(200_000), // $5
        }),
      ],
      NOW,
    );
    // 10:30 → x = 150, in the gap.
    const readout = readoutAt(timelineWithGap, PLOT, 150);
    expect(readout.run).toBeNull();
    expect(readoutDot(timelineWithGap, readout, PLOT)).toEqual({ xPct: 50, cost: 10 });
  });
});

describe("lastStepDot", () => {
  it("sits at the curve's end when nothing is being scrubbed", () => {
    const timeline = buildRunTimeline(
      [
        makeTask({
          started_at: "2026-09-24T10:00:00",
          completed_at: "2026-09-24T10:30:00",
          usage: usage(400_000),
        }),
      ],
      NOW,
    );
    expect(lastStepDot(timeline, PLOT)).toEqual({ xPct: 50, cost: 10 });
  });

  it("has no point without a priced run", () => {
    const timeline = buildRunTimeline([makeTask({ usage: [] })], NOW);
    expect(lastStepDot(timeline, PLOT)).toBeNull();
  });
});

describe("formatTick", () => {
  it("keeps round numbers short and prices the rest to the cent", () => {
    expect(formatTick(50)).toBe("$50");
    expect(formatTick(2.5)).toBe("$2.50");
    expect(formatTick(0.5)).toBe("$0.50");
  });
});
