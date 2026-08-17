import { describe, expect, it } from "vitest";
import {
  ChatPendingTaskSchema,
  ChatSessionSchema,
  SendChatMessageResponseSchema,
} from "./schemas";

describe("ChatPendingTaskSchema", () => {
  it("keeps the pending head and valid queue rows when one row is malformed", () => {
    const parsed = ChatPendingTaskSchema.parse({
      task_id: "task-active",
      status: "running",
      queued_tasks: [
        {
          task_id: "task-next",
          status: "queued",
          created_at: "2026-08-03T00:00:00Z",
        },
        { status: "queued" },
      ],
    });

    expect(parsed.task_id).toBe("task-active");
    expect(parsed.queued_tasks).toEqual([
      {
        task_id: "task-next",
        status: "queued",
        created_at: "2026-08-03T00:00:00Z",
      },
    ]);
  });
});

describe("SendChatMessageResponseSchema", () => {
  const base = {
    message_id: "message-1",
    task_id: "task-1",
    created_at: "2026-08-05T00:00:00Z",
  };

  it("keeps queue position parity with web", () => {
    expect(SendChatMessageResponseSchema.parse({ ...base, queued: false }).queued).toBe(false);
  });

  it("ignores a malformed additive queue position", () => {
    expect(SendChatMessageResponseSchema.parse({ ...base, queued: "no" }).queued).toBeUndefined();
  });
});

describe("ChatSessionSchema pinned", () => {
  const base = {
    id: "session-1",
    workspace_id: "ws-1",
    agent_id: "agent-1",
    creator_id: "user-1",
    title: "hello",
    status: "active",
    has_unread: false,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
  };

  it("defaults pinned to false when the server omits it (older servers)", () => {
    expect(ChatSessionSchema.parse(base).pinned).toBe(false);
  });

  it("passes a pinned pin through for the pin-first list sort", () => {
    const parsed = ChatSessionSchema.parse({ ...base, pinned: true });
    expect(parsed.pinned).toBe(true);
  });

  it("downgrades a malformed pinned value instead of crashing the row", () => {
    const parsed = ChatSessionSchema.parse({ ...base, pinned: "yes" });
    expect(parsed.pinned).toBe(false);
  });
});
