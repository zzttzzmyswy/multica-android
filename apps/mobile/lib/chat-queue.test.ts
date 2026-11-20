import { describe, expect, it, vi } from "vitest";
import type { ChatMessage, ChatPendingTask, ChatQueuedTask } from "@multica/core/types";
import { hideQueuedChatMessages, removePendingChatTask } from "@multica/core/chat/pending";
import { canSteer, queueEditDraftText, queueRows, reconcileQueueCancellation } from "./chat-queue";

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
describe("confirmed queue cancellation", () => {
  it.each(["edit", "remove"] as const)(
    "keeps a rejected %s queued while the authoritative refresh is unresolved",
    async (kind) => {
      const task = TASK({ task_id: "queued", message_id: "message" });
      const sibling = TASK({ task_id: "other", message_id: "sibling" });
      let pending: ChatPendingTask = { task_id: "active", queued_tasks: [task, sibling] };
      let messages = [
        { id: "message", task_id: "queued" },
        { id: "sibling", task_id: "other" },
      ] as ChatMessage[];
      let draft = "original draft";
      let notifyRefresh!: () => void;
      const deferredRefresh = new Promise<void>((resolve) => { notifyRefresh = resolve; });
      const refresh = vi.fn(() => { void deferredRefresh; });
      const failure = new Error("connection dropped");
      const request = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined);
      const action = () => reconcileQueueCancellation(async () => {
        await request();
        messages = messages.filter((message) => message.id !== task.message_id);
        if (kind === "edit") draft = "restored draft";
        pending = removePendingChatTask(pending, task.task_id);
      }, refresh);

      await expect(action()).rejects.toBe(failure);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(queueRows(pending)).toEqual([task, sibling]);
      expect(hideQueuedChatMessages(messages, pending)).toEqual([]);
      expect(draft).toBe("original draft");

      await expect(action()).resolves.toBeUndefined();
      expect(refresh).toHaveBeenCalledTimes(2);
      expect(queueRows(pending)).toEqual([sibling]);
      expect(messages.map((message) => message.id)).toEqual(["sibling"]);
      expect(draft).toBe(kind === "edit" ? "restored draft" : "original draft");
      notifyRefresh();
    },
  );
});
