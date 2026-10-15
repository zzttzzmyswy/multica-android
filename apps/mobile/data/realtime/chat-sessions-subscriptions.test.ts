/**
 * 会话失败后，会话列表那一行必须跟着变（MYS-2178）。
 *
 * 症状：失败气泡已经在对话里，会话列表却还挂着失败前的旧预览，未读徽标也是 0 ——
 * 同一屏上，两处对同一事实给出相反说法，而且是**永久**的。
 *
 * 根因不是「少刷了一次」，而是移动端的 chat 缓存全靠 WS 事件保鲜：
 * `chatSessionsOptions` 的 `staleTime` 是 `Infinity`
 * (`apps/mobile/data/queries/chat.ts:130-139`)，没有任何惰性重取会自我纠正。
 * 成功路径(`chat:done`)与取消路径(`task:cancelled`)都失效了会话列表，唯独
 * `task:failed` 只刷 pending 聚合 —— 而服务端的 `FailTask` 在同一个终态事务里
 * 经 `createAssistantChatMessage` 落了一条失败 assistant 消息
 * (`server/internal/service/task.go:4120-4141`)，所以 `last_message`（预览、
 * `failure_reason`）、`unread_count`、排序三项都变了。
 *
 * 因此这里的断言不是「函数被调用过」，而是**服务端事实落到列表上之后，那一行
 * 渲染成什么**：先钉住失效前那一行的三个值（预览=用户自己的话、未读=0、
 * 排在第 1），再让真实的重取把服务端失败态写回缓存，断言三个值逐个翻转。
 * 半修复形态（只刷 pendingTasks、失效了别的键、给非 chat 任务失败也无条件刷）
 * 都会在这些断言上变红。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type {
  ChatSession,
  TaskFailedPayload,
  WSEventPayload,
  WSEventType,
} from "@multica/core/types";
import { chatKeys, sortChatSessions, splitChatSessions } from "@/data/queries/chat";
import { planChatSessionsSubscriptions } from "./chat-sessions-subscriptions";

// chat-sessions-subscriptions imports chatKeys from data/queries/chat, which
// transitively imports the native fetch client. Mock it so the Node test never
// loads RN modules — chatKeys / the sort helpers are pure and need nothing.
vi.mock("@/data/api", () => ({ api: {} }));

const WS = "ws-1";
const SESSION = "session-failed";
const OTHER = "session-other";

/** Minimal fake socket: records handlers per event so a test can fire one. */
function fakeSocket() {
  const handlers = new Map<string, ((payload: unknown) => void)[]>();
  const reconnect: (() => void)[] = [];
  return {
    on(event: WSEventType, handler: (payload: never) => void) {
      const list = handlers.get(event) ?? [];
      list.push(handler as (payload: unknown) => void);
      handlers.set(event, list);
      return () => {
        handlers.set(
          event,
          (handlers.get(event) ?? []).filter((h) => h !== handler),
        );
      };
    },
    onReconnect(cb: () => void) {
      reconnect.push(cb);
      return () => {
        reconnect.splice(reconnect.indexOf(cb), 1);
      };
    },
    emit<E extends WSEventType>(event: E, payload: WSEventPayload<E>) {
      for (const h of handlers.get(event) ?? []) h(payload);
    },
    reconnect() {
      for (const cb of [...reconnect]) cb();
    },
    handlersFor(event: WSEventType) {
      return handlers.get(event)?.length ?? 0;
    },
  };
}

function session(over: Partial<ChatSession> & { id: string }): ChatSession {
  return {
    workspace_id: WS,
    agent_id: "agent-1",
    creator_id: "user-1",
    title: over.id,
    status: "active",
    has_unread: false,
    unread_count: 0,
    pinned: false,
    created_at: "2026-10-15T00:00:00Z",
    updated_at: "2026-10-15T00:00:00Z",
    last_message: null,
    ...over,
  } as ChatSession;
}

/**
 * The cache as the user sees it right before the failure lands: the turn they
 * sent is the newest row, so the preview is their own prompt, unread is 0
 * (their own message), and that session sorts first.
 */
function staleSessions(): ChatSession[] {
  return [
    session({
      id: SESSION,
      title: "被失败的会话",
      last_message: {
        content: "帮我把这个表格导出成 CSV",
        role: "user",
        created_at: "2026-10-15T10:00:00Z",
        failure_reason: null,
        message_kind: "message",
      },
    }),
    session({
      id: OTHER,
      title: "另一个会话",
      last_message: {
        content: "另一段旧的回复",
        role: "assistant",
        created_at: "2026-10-15T09:00:00Z",
        failure_reason: null,
        message_kind: "message",
      },
    }),
  ];
}

/**
 * The server's post-failure truth — what the invalidated refetch returns.
 * `FailTask` writes the failure as a NEW assistant row, so this session's
 * `last_message` becomes that row: role assistant, a `failure_reason`, and a
 * created_at after the user turn. `unread_count` counts assistant rows past
 * the read cursor, so it flips 0 → 1.
 */
function failureRefetch(): ChatSession[] {
  return [
    session({
      id: SESSION,
      title: "被失败的会话",
      unread_count: 1,
      has_unread: true,
      last_message: {
        content: "API Error: Request rejected (429) · Model tpm limit exceeded",
        role: "assistant",
        created_at: "2026-10-15T10:05:00Z",
        failure_reason: "agent_error.provider_capacity_or_rate_limit",
        message_kind: "message",
      },
    }),
    session({
      id: OTHER,
      title: "另一个会话",
      last_message: {
        content: "另一段旧的回复",
        role: "assistant",
        created_at: "2026-10-15T09:00:00Z",
        failure_reason: null,
        message_kind: "message",
      },
    }),
  ];
}

const failedPayload: TaskFailedPayload = {
  task_id: "task-1",
  agent_id: "agent-1",
  issue_id: "",
  chat_session_id: SESSION,
  status: "failed",
  failure_reason: "agent_error.provider_capacity_or_rate_limit",
  retry_pending: false,
};

/** The row the list would render for `id`, after the list's own ordering. */
function renderedRow(
  qc: QueryClient,
  id: string,
): { preview: "failed" | "content"; unread: number; index: number } {
  const rows = sortChatSessions(
    splitChatSessions(qc.getQueryData<ChatSession[]>(chatKeys.sessions(WS)) ?? [])
      .history,
  );
  const index = rows.findIndex((s) => s.id === id);
  expect(index).toBeGreaterThanOrEqual(0);
  const row = rows[index];
  return {
    preview: row.last_message?.failure_reason ? "failed" : "content",
    unread: row.unread_count ?? 0,
    index,
  };
}

/**
 * Mount the plan against a cache seeded with `seed`, and attach an ACTIVE
 * observer whose queryFn resolves to `rows` — so an invalidation really does
 * refetch, the way a mounted session list does in the app.
 */
function mount(qc: QueryClient, rows: () => ChatSession[]) {
  const ws = fakeSocket();
  const unsubs = planChatSessionsSubscriptions(qc, ws, WS);
  const observer = new QueryObserver<ChatSession[]>(qc, {
    queryKey: chatKeys.sessions(WS),
    queryFn: async () => rows(),
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const unsubscribe = observer.subscribe(() => {});
  return {
    ws,
    unsubs,
    dispose: () => {
      for (const u of unsubs) u();
      unsubscribe();
    },
  };
}

describe("a failed chat turn refreshes the session row", () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient();
    qc.setQueryData<ChatSession[]>(chatKeys.sessions(WS), staleSessions());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("control: before the failure the row shows the user's own prompt, no badge", () => {
    expect(renderedRow(qc, SESSION)).toEqual({
      preview: "content",
      unread: 0,
      index: 0,
    });
  });

  it("invalidates the session list, and the row that lands shows the failure", async () => {
    const { ws, dispose } = mount(qc, failureRefetch);
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    ws.emit("task:failed", failedPayload);

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: chatKeys.sessions(WS),
    });
    // The invalidation's refetch is what the user actually sees. Assert the
    // rendered row, not the call: pre-fix this stays the stale user prompt.
    await vi.waitFor(() => {
      expect(renderedRow(qc, SESSION)).toEqual({
        preview: "failed",
        unread: 1,
        index: 0,
      });
    });
    dispose();
  });

  it("moves the failed session up, because its new assistant row is newer", async () => {
    // Sort position is the third thing the server changes. Seed the ordering
    // so the failing session is the OLDER one, then let the failure land.
    qc.setQueryData<ChatSession[]>(chatKeys.sessions(WS), [
      session({
        id: SESSION,
        last_message: {
          content: "旧的一轮",
          role: "assistant",
          created_at: "2026-10-15T08:00:00Z",
          failure_reason: null,
          message_kind: "message",
        },
      }),
      session({
        id: OTHER,
        last_message: {
          content: "较新的会话",
          role: "assistant",
          created_at: "2026-10-15T09:00:00Z",
          failure_reason: null,
          message_kind: "message",
        },
      }),
    ]);
    expect(renderedRow(qc, SESSION).index).toBe(1);

    const { ws, dispose } = mount(qc, failureRefetch);
    ws.emit("task:failed", failedPayload);

    await vi.waitFor(() => {
      expect(renderedRow(qc, SESSION).index).toBe(0);
    });
    dispose();
  });

  it("still refreshes the pending-task aggregate, debounced", () => {
    // The pre-existing behaviour must survive: the typing indicator is driven
    // by the aggregate, and this branch is what clears it.
    vi.useFakeTimers();
    const { ws, dispose } = mount(qc, failureRefetch);
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    ws.emit("task:failed", failedPayload);
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: chatKeys.pendingTasks(WS),
    });

    vi.advanceTimersByTime(750);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: chatKeys.pendingTasks(WS),
    });
    dispose();
  });

  it("does not refresh the session list for a non-chat task failure", () => {
    // `task:failed` is a workspace fanout: every issue-run failure in the
    // workspace arrives here. Those carry no chat_session_id and cannot change
    // any session row, so the list must not be refetched for them — a phone on
    // cellular would otherwise drain a session-list request per failed run.
    const { ws, dispose } = mount(qc, failureRefetch);
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    ws.emit("task:failed", {
      ...failedPayload,
      chat_session_id: undefined,
      issue_id: "issue-1",
    });

    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: chatKeys.sessions(WS),
    });
    expect(renderedRow(qc, SESSION).preview).toBe("content");
    dispose();
  });

  it("does NOT refresh the session list on task:completed", () => {
    // The success path persists its assistant row through `chat:done`, which
    // already invalidates. Mirroring the failure branch "for symmetry" would
    // add a second session-list refetch per completed turn for no new
    // information — on cellular that is the difference that matters.
    const { ws, dispose } = mount(qc, failureRefetch);
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    ws.emit("task:completed", {
      task_id: "task-1",
      agent_id: "agent-1",
      issue_id: "",
      chat_session_id: SESSION,
      status: "completed",
    });

    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: chatKeys.sessions(WS),
    });
    dispose();
  });

  it("leaves chat:done and task:cancelled on their existing path", () => {
    // Those two were already correct; a "tidy-up" that rerouted them would be
    // an unrequested behaviour change, and the repo forbids it.
    const { ws, dispose } = mount(qc, failureRefetch);
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    ws.emit("chat:done", {
      chat_session_id: SESSION,
      task_id: "task-1",
      message_id: "msg-1",
      content: "here is the chart",
      created_at: "2026-10-15T10:05:00Z",
      elapsed_ms: 1200,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: chatKeys.sessions(WS),
    });

    invalidate.mockClear();
    ws.emit("task:cancelled", {
      task_id: "task-1",
      agent_id: "agent-1",
      issue_id: "",
      chat_session_id: SESSION,
      status: "cancelled",
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: chatKeys.sessions(WS),
    });
    dispose();
  });

  it("reconnect still re-invalidates both caches", () => {
    const { ws, dispose } = mount(qc, failureRefetch);
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    ws.reconnect();
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: chatKeys.sessions(WS),
    });

    // The aggregate invalidate is debounced — assert it under timers.
    vi.useFakeTimers();
    ws.reconnect();
    vi.advanceTimersByTime(750);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: chatKeys.pendingTasks(WS),
    });
    dispose();
  });

  it("subscribes exactly once per event and returns working unsubs", () => {
    const { ws, unsubs, dispose } = mount(qc, failureRefetch);
    expect(ws.handlersFor("task:failed")).toBe(1);
    expect(ws.handlersFor("chat:done")).toBe(1);

    for (const u of unsubs) u();
    expect(ws.handlersFor("task:failed")).toBe(0);
    expect(ws.handlersFor("chat:done")).toBe(0);
    dispose();
  });
});
