import { afterEach, describe, expect, it } from "vitest";
import {
  enqueueInLane,
  getLaneSize,
  clearLane,
  setLaneConcurrency,
  resetLanesForTests,
} from "./command-queue.js";

afterEach(() => {
  resetLanesForTests();
});

describe("command queue", () => {
  it("runs tasks serially by default (maxConcurrent = 1)", async () => {
    let active = 0;
    let maxActive = 0;
    const order: number[] = [];

    const makeTask = (id: number) => async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(id);
      await new Promise((r) => setTimeout(r, 10));
      active -= 1;
      return id;
    };

    const results = await Promise.all([
      enqueueInLane("test", makeTask(1)),
      enqueueInLane("test", makeTask(2)),
      enqueueInLane("test", makeTask(3)),
    ]);

    expect(results).toEqual([1, 2, 3]);
    expect(order).toEqual([1, 2, 3]);
    expect(maxActive).toBe(1);
  });

  it("respects maxConcurrent limit", async () => {
    setLaneConcurrency("test", 3);

    let active = 0;
    let maxActive = 0;

    const makeTask = (id: number) => async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 20));
      active -= 1;
      return id;
    };

    const results = await Promise.all([
      enqueueInLane("test", makeTask(1)),
      enqueueInLane("test", makeTask(2)),
      enqueueInLane("test", makeTask(3)),
      enqueueInLane("test", makeTask(4)),
      enqueueInLane("test", makeTask(5)),
    ]);

    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(maxActive).toBe(3);
  });

  it("reports correct lane size", async () => {
    setLaneConcurrency("test", 1);

    let resolveFirst!: () => void;
    const blocker = new Promise<void>((r) => {
      resolveFirst = r;
    });

    // First task blocks the lane
    const p1 = enqueueInLane("test", () => blocker);
    // Second task queued
    const p2 = enqueueInLane("test", async () => "done");

    // 1 active + 1 queued = 2
    expect(getLaneSize("test")).toBe(2);

    resolveFirst();
    await Promise.all([p1, p2]);

    expect(getLaneSize("test")).toBe(0);
  });

  it("clears pending tasks", async () => {
    setLaneConcurrency("test", 1);

    let resolveFirst!: () => void;
    const blocker = new Promise<void>((r) => {
      resolveFirst = r;
    });

    const p1 = enqueueInLane("test", () => blocker);
    const p2 = enqueueInLane("test", async () => "should-not-run");
    const p3 = enqueueInLane("test", async () => "should-not-run");

    const removed = clearLane("test");
    expect(removed).toBe(2);

    resolveFirst();
    await p1;

    // p2 and p3 should reject
    await expect(p2).rejects.toThrow("Lane cleared");
    await expect(p3).rejects.toThrow("Lane cleared");

    expect(getLaneSize("test")).toBe(0);
  });

  it("returns 0 for unknown lane", () => {
    expect(getLaneSize("nonexistent")).toBe(0);
    expect(clearLane("nonexistent")).toBe(0);
  });
});
