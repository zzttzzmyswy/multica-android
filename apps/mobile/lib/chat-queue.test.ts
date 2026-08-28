import { describe, expect, it } from "vitest";
import type { ChatPendingTask, ChatQueuedTask } from "@multica/core/types";
import { canSteer, queueEditDraftText, queueRows } from "./chat-queue";

const TASK = (overrides: Partial<ChatQueuedTask> = {}): ChatQueuedTask => ({
  task_id: "task-1",
  status: "queued",
  created_at: "2026-08-29T00:00:00Z",
  ...overrides,
});

describe("queueRows", () => {
  it("returns [] for an empty pending task", () => {
    expect(queueRows(undefined)).toEqual([]);
    expect(queueRows({})).toEqual([]);
  });

  it("returns queued_tasks verbatim when present", () => {
    const queue = [TASK({ task_id: "a" }), TASK({ task_id: "b" })];
    expect(queueRows({ task_id: "head", queued_tasks: queue })).toEqual(queue);
  });
});

describe("canSteer", () => {
  it("is true while the head is dispatched / running / waiting_local_directory", () => {
    for (const status of ["dispatched", "running", "waiting_local_directory"]) {
      expect(canSteer({ task_id: "head", status })).toBe(true);
    }
  });

  it("is false while the head is queued or unknown", () => {
    expect(canSteer({ task_id: "head", status: "queued" })).toBe(false);
    expect(canSteer({ task_id: "head" })).toBe(false);
    expect(canSteer(undefined)).toBe(false);
  });
});

describe("queueEditDraftText", () => {
  it("returns the trimmed content", () => {
    expect(queueEditDraftText(TASK({ content: "  fix typo  " }))).toBe("fix typo");
  });

  it("returns null for blank content so the caller falls back to i18n", () => {
    expect(queueEditDraftText(TASK())).toBeNull();
    expect(queueEditDraftText(TASK({ content: "   " }))).toBeNull();
  });
});