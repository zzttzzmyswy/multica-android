import { describe, expect, it, vi, beforeEach, beforeAll } from "vitest";

process.env.EXPO_PUBLIC_API_URL = "https://api.test";

vi.mock("expo-file-system", () => ({
  File: class {
    uri = "file:///mock";
    exists = false;
  },
  Paths: { document: { uri: "file:///doc" } },
}));

vi.mock("expo-file-system/legacy", () => ({
  createDownloadResumable: vi.fn(),
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

type ApiClient = typeof import("./api").api;
let api: ApiClient;

const fetchSpy = () =>
  vi.spyOn(api as unknown as { fetch: () => Promise<unknown> }, "fetch");

beforeAll(async () => {
  ({ api } = await import("./api"));
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("chat queued-task queue api methods", () => {
  it("cancelTaskById without options POSTs the plain cancel url (regression guard)", async () => {
    const spy = fetchSpy().mockResolvedValue({});
    await api.cancelTaskById("task-1");
    expect(spy).toHaveBeenCalledWith(
      "/api/tasks/task-1/cancel",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("cancelTaskById with queuedAction=remove appends expected_status + chat_session_id + queue_action", async () => {
    const spy = fetchSpy().mockResolvedValue({});
    await api.cancelTaskById("task-1", {
      queuedAction: "remove",
      sessionId: "session-1",
    });
    expect(spy).toHaveBeenCalledWith(
      "/api/tasks/task-1/cancel?expected_status=queued&chat_session_id=session-1&queue_action=remove",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("cancelTaskById with queuedAction=edit sends queue_action=edit", async () => {
    const spy = fetchSpy().mockResolvedValue({});
    await api.cancelTaskById("task-1", {
      queuedAction: "edit",
      sessionId: "session-1",
    });
    expect(spy).toHaveBeenCalledWith(
      "/api/tasks/task-1/cancel?expected_status=queued&chat_session_id=session-1&queue_action=edit",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("cancelTaskById with a queuedAction but no sessionId throws (mirrors web invariant)", async () => {
    await expect(
      api.cancelTaskById("task-1", { queuedAction: "remove" }),
    ).rejects.toThrow("sessionId is required for queued-only cancellation");
  });

  it("prioritizeQueuedChatTask POSTs the prioritize endpoint and parses the response", async () => {
    const spy = fetchSpy().mockResolvedValue({
      task_id: "task-2",
      active_task_id: "task-1",
    });
    const res = await api.prioritizeQueuedChatTask("session-1", "task-2");
    expect(spy).toHaveBeenCalledWith(
      "/api/chat/sessions/session-1/queued-tasks/task-2/prioritize",
      expect.objectContaining({ method: "POST" }),
    );
    expect(res.task_id).toBe("task-2");
    expect(res.active_task_id).toBe("task-1");
  });

  it("prioritizeQueuedChatTask falls back to an empty task on a malformed payload", async () => {
    fetchSpy().mockResolvedValue({ oops: true });
    const res = await api.prioritizeQueuedChatTask("session-1", "task-2");
    expect(res).toEqual({ task_id: "" });
  });

  it("clearQueuedChatTasks DELETEs the session queued-tasks collection", async () => {
    const spy = fetchSpy().mockResolvedValue(undefined);
    await api.clearQueuedChatTasks("session-1");
    expect(spy).toHaveBeenCalledWith(
      "/api/chat/sessions/session-1/queued-tasks",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});