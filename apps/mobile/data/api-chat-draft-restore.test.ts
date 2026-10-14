/**
 * Cancelled-prompt restore — HTTP layer (#5219).
 *
 * Three things have to hold at the wire boundary, and each one is the difference
 * between recovering the user's prompt and losing it:
 *   1. the cancel declares the capability, or the server takes the legacy branch;
 *   2. the cancel PARSES its response, because on that legacy branch the body is
 *      the only remaining copy of the prompt;
 *   3. the durable endpoints exist and degrade to "nothing pending" on a server
 *      that predates them.
 *
 * Same native-module stubs as the neighbouring api-*.test.ts files (the Node
 * vitest lane has no RN).
 */
process.env.EXPO_PUBLIC_API_URL = "https://api.test";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-file-system", () => ({
  File: class {
    uri = "file:///mock";
    exists = false;
  },
  Paths: {
    document: { uri: "file:///doc" },
    cache: { uri: "file:///cache" },
  },
}));

vi.mock("expo-file-system/legacy", () => ({
  createDownloadResumable: vi.fn(),
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

let api: typeof import("./api").api;

beforeAll(async () => {
  ({ api } = await import("./api"));
});

beforeEach(() => {
  vi.restoreAllMocks();
});

type FetchCall = [path: string, init?: RequestInit];

const fetchSpy = () =>
  vi.spyOn(
    api as unknown as { fetch: (path: string, init?: RequestInit) => Promise<unknown> },
    "fetch",
  );

function lastCall(spy: ReturnType<typeof fetchSpy>): FetchCall {
  const calls = spy.mock.calls as unknown as FetchCall[];
  return calls[calls.length - 1];
}

describe("cancelTaskById declares the draft-restore capability", () => {
  it("sends X-Client-Capabilities on a plain stop", async () => {
    const spy = fetchSpy().mockResolvedValue({});
    await api.cancelTaskById("task-1");
    const [, init] = lastCall(spy);
    expect(
      (init?.headers as Record<string, string>)["X-Client-Capabilities"],
    ).toBe("chat-draft-restore-v1");
  });

  it("still declares it on a queued-only cancel", async () => {
    // The queued-only branch also writes a durable row (settleQueuedChatInput),
    // so the capability is not only about the started-task case.
    const spy = fetchSpy().mockResolvedValue({});
    await api.cancelTaskById("task-1", {
      queuedAction: "edit",
      sessionId: "session-1",
    });
    const [path, init] = lastCall(spy);
    expect(path).toBe(
      "/api/tasks/task-1/cancel?expected_status=queued&chat_session_id=session-1&queue_action=edit",
    );
    expect(
      (init?.headers as Record<string, string>)["X-Client-Capabilities"],
    ).toBe("chat-draft-restore-v1");
  });
});

describe("cancelTaskById reads the response body", () => {
  it("returns the synchronous restore the server handed back", async () => {
    // The regression this whole iteration exists for: the method used to be
    // typed `Promise<void>` and the body — the only copy of the prompt on the
    // legacy branch — was thrown away.
    fetchSpy().mockResolvedValue({
      id: "task-1",
      status: "cancelled",
      cancelled_chat_message: {
        chat_session_id: "session-1",
        message_id: "msg-1",
        content: "the lost prompt",
        restore_to_input: true,
        attachments: [{ id: "att-1", filename: "a.png", url: "/u", download_url: "/d", content_type: "image/png" }],
      },
    });
    const result = await api.cancelTaskById("task-1");
    expect(result.cancelled_chat_message?.content).toBe("the lost prompt");
    expect(result.cancelled_chat_message?.restore_to_input).toBe(true);
    expect(result.cancelled_chat_message?.attachments?.[0]?.id).toBe("att-1");
  });

  it("leaves cancelled_chat_message undefined on the deferred branch", async () => {
    // The capability switches the server to parking the prompt in a durable row
    // instead of returning it, so absence here is expected — not a bug.
    fetchSpy().mockResolvedValue({ id: "task-1", status: "cancelled" });
    const result = await api.cancelTaskById("task-1");
    expect(result.cancelled_chat_message).toBeUndefined();
  });

  it("degrades a malformed response to the empty fallback instead of throwing", async () => {
    // A prompt must never be lost to a schema-drift crash: the durable row (or
    // the next fetch) is still the recovery path.
    fetchSpy().mockResolvedValue({ cancelled_chat_message: { content: 42 } });
    const result = await api.cancelTaskById("task-1");
    expect(result.cancelled_chat_message).toBeUndefined();
    expect(result.status).toBe("cancelled");
  });

  it("defaults restore_to_input to false when the server omits it", async () => {
    fetchSpy().mockResolvedValue({
      id: "task-1",
      cancelled_chat_message: {
        chat_session_id: "session-1",
        message_id: "msg-1",
        content: "x",
      },
    });
    const result = await api.cancelTaskById("task-1");
    expect(result.cancelled_chat_message?.restore_to_input).toBe(false);
  });

  it("drops the payload when the enclosing task row is malformed (web parity)", async () => {
    // The response is one object: `CancelTaskResponseSchema` extends the task
    // schema, so an unparseable task row takes the message payload with it.
    // Kept deliberately identical to web rather than papered over on mobile —
    // two clients disagreeing about which cancels restorable says which client
    // loses the prompt. The server always sends `id` (`taskToResponse` off a
    // UUID PK), so this is drift defense, not a reachable state.
    fetchSpy().mockResolvedValue({
      cancelled_chat_message: {
        chat_session_id: "session-1",
        message_id: "msg-1",
        content: "x",
        restore_to_input: true,
      },
    });
    const result = await api.cancelTaskById("task-1");
    expect(result.cancelled_chat_message).toBeUndefined();
  });
});

describe("listChatDraftRestores", () => {
  it("reads the session's durable rows", async () => {
    const spy = fetchSpy().mockResolvedValue({
      restores: [
        {
          id: "msg-1",
          chat_session_id: "session-1",
          content: "parked prompt",
          attachments: [],
        },
      ],
    });
    const result = await api.listChatDraftRestores("session-1");
    expect(lastCall(spy)[0]).toBe("/api/chat/sessions/session-1/draft-restores");
    expect(result.restores[0].content).toBe("parked prompt");
  });

  it("returns nothing pending when the endpoint is 404 (older server)", async () => {
    const { ApiError } = await import("./api");
    fetchSpy().mockRejectedValue(new ApiError("not found", 404));
    await expect(api.listChatDraftRestores("session-1")).resolves.toEqual({
      restores: [],
    });
  });

  it("still surfaces a real transport failure", async () => {
    const { ApiError } = await import("./api");
    fetchSpy().mockRejectedValue(new ApiError("boom", 500));
    await expect(api.listChatDraftRestores("session-1")).rejects.toThrow("boom");
  });

  it("degrades a malformed payload to an empty list, leaving the row on the server", async () => {
    // Skipping a fetch costs nothing: the durable row stays pending and is
    // offered again on the next mount.
    fetchSpy().mockResolvedValue({ restores: "nope" });
    await expect(api.listChatDraftRestores("session-1")).resolves.toEqual({
      restores: [],
    });
  });
});

describe("consumeChatDraftRestore", () => {
  it("DELETEs the row (idempotent server-side)", async () => {
    const spy = fetchSpy().mockResolvedValue(undefined);
    await api.consumeChatDraftRestore("session-1", "msg-1");
    const [path, init] = lastCall(spy);
    expect(path).toBe("/api/chat/sessions/session-1/draft-restores/msg-1");
    expect(init?.method).toBe("DELETE");
  });
});
