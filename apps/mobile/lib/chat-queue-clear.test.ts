/**
 * 「清空排队」的幽灵气泡守卫（MYS-2177）。
 *
 * 症状是：用户点「清空所有」，服务端已把那些消息删掉，手机上的气泡却**重新
 * 出现**并且永久留在屏幕上。原因是对话列表由 `hideQueuedChatMessages` 过滤
 * 而来 —— 排队中的气泡被 `pending.queued_tasks` 的 `message_id` 藏起来，本体
 * 一直在扁平的 messages 缓存里；`queued_tasks` 一置空，过滤条件消失，气泡
 * 现形，而 `finally` 又只失效 pendingTask，没人再纠正它。
 *
 * 所以这里的断言不是「函数被调用过」，而是**渲染出来的那个列表**：
 * `visibleMessages` = `hideQueuedChatMessages(messages, pendingTask)`，在清空
 * 之后既不能有那条被隐藏的排队气泡（服务端已删），也不能把未认领的头任务
 * 一起清掉（服务端保留它）。
 *
 * 另外三条是 half-fix 形态的守卫：请求后才取待删清单（在途 refetch 会把清单
 * 抹空 → 能过类型检查的死代码）、失败也照样清空（留下「已清空」的假象）、
 * 置空先于摘气泡（气泡闪一下再消失）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { ChatMessage, ChatPendingTask } from "@multica/core/types";
import { hideQueuedChatMessages } from "@multica/core/chat/pending";

vi.mock("@/data/api", () => ({
  api: { clearQueuedChatTasks: vi.fn() },
}));

const { api } = await import("@/data/api");
const { chatKeys } = await import("@/data/queries/chat");
const { clearChatQueue } = await import("./chat-queue-clear");

const SESSION = "session-1";
const WS = "ws-1";

const clearMock = api.clearQueuedChatTasks as unknown as ReturnType<typeof vi.fn>;

function message(id: string, taskId: string | null = null): ChatMessage {
  return {
    id,
    chat_session_id: SESSION,
    role: "user",
    content: id,
    task_id: taskId,
    created_at: "2026-10-15T00:00:00Z",
  };
}

/** 头任务（未认领，服务端保留）+ 两条排队后续任务（服务端会删）。 */
function pendingFixture(): ChatPendingTask {
  return {
    task_id: "task-head",
    status: "queued",
    created_at: "2026-10-15T00:00:00Z",
    supports_queue: true,
    queued_tasks: [
      { task_id: "task-a", status: "queued", created_at: "2026-10-15T00:01:00Z", message_id: "msg-a", content: "queued A" },
      { task_id: "task-b", status: "queued", created_at: "2026-10-15T00:02:00Z", message_id: "msg-b", content: "queued B" },
    ],
  };
}

/** messages 缓存 = 头任务的气泡 + 两条排队气泡（发送时的乐观写入）。 */
function seed(qc: QueryClient) {
  qc.setQueryData<ChatMessage[]>(chatKeys.messages(SESSION), [
    message("msg-head", "task-head"),
    message("msg-a", "task-a"),
    message("msg-b", "task-b"),
  ]);
  qc.setQueryData<ChatPendingTask>(chatKeys.pendingTask(SESSION), pendingFixture());
}

/** 屏幕上真正渲染的那个数组。 */
function visible(qc: QueryClient): string[] {
  return hideQueuedChatMessages(
    qc.getQueryData<ChatMessage[]>(chatKeys.messages(SESSION)) ?? [],
    qc.getQueryData<ChatPendingTask>(chatKeys.pendingTask(SESSION)),
  ).map((m) => m.id);
}

beforeEach(() => {
  vi.restoreAllMocks();
  clearMock.mockReset();
  clearMock.mockResolvedValue(undefined);
});

describe("clearChatQueue", () => {
  it("leaves no ghost bubble: the server-deleted queue is gone from the rendered list", async () => {
    const qc = new QueryClient();
    seed(qc);
    // 清空前：排队气泡被 pending 过滤掉，屏上是头任务一条。
    expect(visible(qc)).toEqual(["msg-head"]);

    await clearChatQueue(qc, SESSION, WS);

    // 清空后：队列空 + 气泡也从 messages 缓存里摘掉了，所以不会现形。
    expect(visible(qc)).toEqual(["msg-head"]);
    expect(qc.getQueryData<ChatMessage[]>(chatKeys.messages(SESSION))?.map((m) => m.id))
      .toEqual(["msg-head"]);
  });

  it("keeps the unclaimed FIFO head — the server only cancels follow-ups", async () => {
    const qc = new QueryClient();
    seed(qc);
    await clearChatQueue(qc, SESSION, WS);
    const pending = qc.getQueryData<ChatPendingTask>(chatKeys.pendingTask(SESSION));
    expect(pending?.task_id).toBe("task-head");
    expect(pending?.queued_tasks).toEqual([]);
    // `supports_queue` 是能力位，由服务端下发，清理队列不应把它丢掉。
    expect(pending?.supports_queue).toBe(true);
  });

  it("collects the doomed messages BEFORE the request, so an in-flight refetch cannot blank the list", async () => {
    // 移动端的 pendingTask 带 refetchInterval 轮询。若按 web 的字面顺序在
    // 请求返回后才读 queued_tasks，中间落地的任何一次 refetch 都会把清单清空,
    // 于是「什么都没删」——这正是能过类型检查的死代码形态。
    const qc = new QueryClient();
    seed(qc);
    clearMock.mockImplementation(async () => {
      // 请求在途时，另一路（轮询 / WS / 其它标签页）把队列清掉了。
      qc.setQueryData<ChatPendingTask>(chatKeys.pendingTask(SESSION), (old) =>
        old ? { ...old, queued_tasks: [] } : {},
      );
    });

    await clearChatQueue(qc, SESSION, WS);

    expect(qc.getQueryData<ChatMessage[]>(chatKeys.messages(SESSION))?.map((m) => m.id))
      .toEqual(["msg-head"]);
  });

  it("evicts the bubbles before it empties the queue (no现形-then-消失 flicker)", async () => {
    const qc = new QueryClient();
    seed(qc);
    const sets: string[] = [];
    const spy = vi.spyOn(qc, "setQueryData");
    spy.mockImplementation(((key: unknown) => {
      sets.push(JSON.stringify(key));
      return undefined;
    }) as never);

    await clearChatQueue(qc, SESSION, WS);

    const firstMessages = sets.findIndex((k) => k === JSON.stringify(chatKeys.messages(SESSION)));
    const firstQueue = sets.findIndex((k) => k === JSON.stringify(chatKeys.pendingTask(SESSION)));
    expect(firstMessages).toBeGreaterThanOrEqual(0);
    expect(firstQueue).toBeGreaterThanOrEqual(0);
    expect(firstMessages).toBeLessThan(firstQueue);
  });

  it("cancels an in-flight pending refetch before the DELETE goes out", async () => {
    const qc = new QueryClient();
    seed(qc);
    const cancel = vi.spyOn(qc, "cancelQueries");
    const order: string[] = [];
    cancel.mockImplementation((async () => {
      order.push("cancel");
    }) as never);
    clearMock.mockImplementation(async () => {
      order.push("delete");
    });

    await clearChatQueue(qc, SESSION, WS);

    expect(cancel).toHaveBeenCalledWith({
      queryKey: chatKeys.pendingTask(SESSION),
    });
    expect(order).toEqual(["cancel", "delete"]);
  });

  it("re-aligns pendingTask and messages on success — the authoritative refetch", async () => {
    const qc = new QueryClient();
    seed(qc);
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    await clearChatQueue(qc, SESSION, WS);

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: chatKeys.pendingTask(SESSION),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: chatKeys.messages(SESSION),
    });
  });

  it("keeps the pagination cursor — the window edge did not move", async () => {
    // 移动端 messagesPage 是纯客户端的游标槽位（键指向更旧的一页），照搬 web
    // 的 infinite-query 失效会把用户已翻出的历史窗口重置。
    const qc = new QueryClient();
    seed(qc);
    qc.setQueryData(chatKeys.messagesPage(SESSION), { hasMore: true, cursor: "cursor-1" });
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    await clearChatQueue(qc, SESSION, WS);

    const keys = invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).not.toContain(JSON.stringify(chatKeys.messagesPage(SESSION)));
    expect(qc.getQueryData(chatKeys.messagesPage(SESSION))).toEqual({
      hasMore: true,
      cursor: "cursor-1",
    });
  });

  it("touches the workspace pending aggregate so the IM list stops showing the queue", async () => {
    const qc = new QueryClient();
    seed(qc);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    await clearChatQueue(qc, SESSION, WS);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: chatKeys.pendingTasks(WS),
    });
  });

  it("fails loudly and leaves the queue intact — no 'cleared' illusion", async () => {
    const qc = new QueryClient();
    seed(qc);
    clearMock.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(clearChatQueue(qc, SESSION, WS)).rejects.toThrow("boom");

    // 服务端没删成功 → 气泡与队列都必须原样留着。
    expect(visible(qc)).toEqual(["msg-head"]);
    expect(qc.getQueryData<ChatPendingTask>(chatKeys.pendingTask(SESSION))?.queued_tasks)
      .toHaveLength(2);
    expect(qc.getQueryData<ChatMessage[]>(chatKeys.messages(SESSION))?.map((m) => m.id))
      .toEqual(["msg-head", "msg-a", "msg-b"]);
  });

  it("still re-aligns both caches when the request fails", async () => {
    const qc = new QueryClient();
    seed(qc);
    clearMock.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    await expect(clearChatQueue(qc, SESSION, WS)).rejects.toThrow();

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: chatKeys.pendingTask(SESSION),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: chatKeys.messages(SESSION),
    });
  });

  it("is a no-op beyond the request when nothing is queued", async () => {
    const qc = new QueryClient();
    qc.setQueryData<ChatMessage[]>(chatKeys.messages(SESSION), [message("msg-head", "task-head")]);
    qc.setQueryData<ChatPendingTask>(chatKeys.pendingTask(SESSION), {
      task_id: "task-head",
      status: "running",
      queued_tasks: [],
    });

    await clearChatQueue(qc, SESSION, WS);

    expect(qc.getQueryData<ChatMessage[]>(chatKeys.messages(SESSION))?.map((m) => m.id))
      .toEqual(["msg-head"]);
    expect(qc.getQueryData<ChatPendingTask>(chatKeys.pendingTask(SESSION))?.task_id)
      .toBe("task-head");
  });

  it("survives a session whose caches were never seeded", async () => {
    const qc = new QueryClient();
    await expect(clearChatQueue(qc, SESSION, WS)).resolves.toBeUndefined();
    expect(clearMock).toHaveBeenCalledWith(SESSION);
  });
});
