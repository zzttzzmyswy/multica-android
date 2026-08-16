import { describe, expect, it } from "vitest";
import type { ChatPendingTask } from "@multica/core/types";
import {
  CHAT_TASK_POLL_INTERVAL_MS,
  didPendingTaskFinish,
  isPendingTaskActive,
  pendingTaskPollMs,
} from "./chat-task-polling";

describe("isPendingTaskActive", () => {
  it("undefined / null / empty {} are idle", () => {
    expect(isPendingTaskActive(undefined)).toBe(false);
    expect(isPendingTaskActive(null)).toBe(false);
    expect(isPendingTaskActive({})).toBe(false);
    expect(
      isPendingTaskActive({
        queued_tasks: [
          { task_id: "q1", status: "queued", created_at: "x" },
        ],
      }),
    ).toBe(false);
  });

  it("a root task_id means a task is in flight", () => {
    expect(isPendingTaskActive({ task_id: "a0b1c2d3-a0b1-c2d3-a0b1-c2d3a0b1c2d3" })).toBe(
      true,
    );
    expect(
      isPendingTaskActive({ task_id: "t1", status: "queued", created_at: "x" }),
    ).toBe(true);
  });
});

describe("pendingTaskPollMs", () => {
  it("polls while a task is in flight", () => {
    const query = { state: { data: { task_id: "t1" } } };
    expect(pendingTaskPollMs(query)).toBe(CHAT_TASK_POLL_INTERVAL_MS);
  });

  it("stops polling when idle", () => {
    expect(pendingTaskPollMs({ state: { data: {} } })).toBe(false);
    expect(pendingTaskPollMs({ state: { data: undefined } })).toBe(false);
  });
});

describe("didPendingTaskFinish", () => {
  it("fires only on the active → idle edge", () => {
    expect(didPendingTaskFinish({ task_id: "t1" }, {})).toBe(true);
    expect(didPendingTaskFinish({ task_id: "t1" }, undefined)).toBe(true);
    expect(didPendingTaskFinish({ task_id: "t1" }, null)).toBe(true);
  });

  it("does not fire on idle → active or active → active (task swap)", () => {
    expect(didPendingTaskFinish(undefined, { task_id: "t2" })).toBe(false);
    expect(didPendingTaskFinish({}, { task_id: "t2" })).toBe(false);
    expect(didPendingTaskFinish({ task_id: "t1" }, { task_id: "t2" })).toBe(false);
    expect(didPendingTaskFinish({}, {})).toBe(false);
    expect(didPendingTaskFinish(undefined, undefined)).toBe(false);
    expect(didPendingTaskFinish(undefined, {})).toBe(false);
  });
});