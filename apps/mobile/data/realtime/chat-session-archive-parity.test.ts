/**
 * 别的设备/网页归档一个会话之后，手机上那一行必须跟着走（MYS-2183）。
 *
 * 症状：在 web 或另一台设备上把会话归档，手机上的那一行**什么都不变** —— 它继续
 * 留在历史列表里，未读徽标也继续亮着。不是「一个渲染帧」，而是**永不自愈**：
 * `chatSessionsOptions` 的 `staleTime` 是 `Infinity`
 * (`apps/mobile/data/queries/chat.ts:138`)，会话缓存只靠 WS 事件保鲜，唯一的纠正
 * 要等 socket 重连触发的 `onReconnect → invalidateSessions`
 * (`chat-sessions-subscriptions.ts`)。只要不断线，这一路就一直是错的。
 *
 * 根因是**同一事件、两种处理**：web 的 `applyChatSessionUpdatedToCache`
 * (`packages/core/realtime/use-realtime-sync.ts:348-372`) 一次应用 `title` /
 * `project_id` / `pinned` / `status` / `updated_at` 五个字段并在 `status ===
 * "archived"` 时清零未读；移动端只应用三个，`status` / `project_id` / 清零整层缺失。
 * 而服务端归档时**确实发 `status`**（`server/internal/handler/chat.go:639-644`）。
 *
 * 所以这里的断言不是「函数被调用过」，而是**把事件喂进真实的订阅 plan 之后，那一行
 * 在屏幕上渲染成什么**：
 *   1. 它落在哪个桶里 —— `splitChatSessions` 按 `status` 本地分桶，历史/归档两个
 *      列表就是这么来的 (`apps/mobile/data/queries/chat.ts:116-128`)；
 *   2. 它的未读徽标 —— 行内红点读 `session.unread_count`
 *      (`app/(app)/[workspace]/chat-sessions.tsx:119`)；
 *   3. 它的排序位；
 *   4. 它对 Chat Tab 徽标的贡献 —— `countUnreadChatMessages` 直接累加
 *      `unread_count` 且**不过滤 archived** (`packages/core/chat/unread.ts:21-31`)，
 *      消费点 `lib/unread-counts.ts`。
 *
 * 半修复形态都会在这些断言上变红：只补 `status` 不清零（红点仍亮）、只清零不补
 * `status`（行留在历史列表）、`?? "active"`（未归档的也被判成 active）、
 * `project_id` 用 `!== undefined`（显式 null 清不掉绑定）。
 */
import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { ChatSession, WSEventPayload, WSEventType } from "@multica/core/types";
import { countUnreadChatMessages } from "@multica/core/chat/unread";
import { chatKeys, splitChatSessions } from "@/data/queries/chat";
import { planChatSessionsSubscriptions } from "./chat-sessions-subscriptions";

// chat-sessions-subscriptions imports chatKeys from data/queries/chat, which
// transitively imports the native fetch client. Mock it so the Node test never
// loads RN modules.
vi.mock("@/data/api", () => ({ api: {} }));

const WS = "ws-1";
const ARCHIVED_ELSEWHERE = "session-archived-elsewhere";
const OTHERS = ["session-b", "session-c"];

/** Minimal fake socket: records handlers per event so a test can fire one. */
function fakeSocket() {
  const handlers = new Map<string, ((payload: unknown) => void)[]>();
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
    onReconnect() {
      return () => {};
    },
    emit<E extends WSEventType>(event: E, payload: WSEventPayload<E>) {
      for (const h of handlers.get(event) ?? []) h(payload);
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
 * The cache as the phone holds it right before the other device archives: the
 * target session is the newest active row AND carries 2 unread replies — so it
 * leads the history list, shows a "2" badge, and contributes 2 to the Chat tab
 * badge.
 */
function cachedBeforeArchive(): ChatSession[] {
  return [
    session({
      id: ARCHIVED_ELSEWHERE,
      title: "被别处归档的会话",
      has_unread: true,
      unread_count: 2,
      updated_at: "2026-10-15T10:00:00Z",
      last_message: {
        content: "两条没人看的回复",
        role: "assistant",
        created_at: "2026-10-15T10:00:00Z",
        failure_reason: null,
        message_kind: "message",
      },
    }),
    session({
      id: OTHERS[0]!,
      unread_count: 1,
      has_unread: true,
      updated_at: "2026-10-15T09:00:00Z",
      last_message: {
        content: "另一条回复",
        role: "assistant",
        created_at: "2026-10-15T09:00:00Z",
        failure_reason: null,
        message_kind: "message",
      },
    }),
    session({
      id: OTHERS[1]!,
      updated_at: "2026-10-15T08:00:00Z",
      last_message: {
        content: "很久以前",
        role: "assistant",
        created_at: "2026-10-15T08:00:00Z",
        failure_reason: null,
        message_kind: "message",
      },
    }),
  ];
}

/** What the screen renders for the target row, read the way the screen reads it. */
function rendered(qc: QueryClient, id: string) {
  const rows = qc.getQueryData<ChatSession[]>(chatKeys.sessions(WS)) ?? [];
  const buckets = splitChatSessions(rows);
  const inHistory = buckets.history.findIndex((s) => s.id === id);
  const inArchived = buckets.archived.findIndex((s) => s.id === id);
  const row = [...buckets.history, ...buckets.archived].find((s) => s.id === id)!;
  return {
    bucket: inHistory >= 0 ? ("history" as const) : ("archived" as const),
    // Row's own red dot: `chat-sessions.tsx` renders `unread_count > 0`.
    badge: row.unread_count ?? 0,
    historyIndex: inHistory,
    archivedIndex: inArchived,
    // Chat Tab badge share — `countUnreadChatMessages` over the whole cache.
    tabBadge: countUnreadChatMessages(rows),
    hasUnreadFlag: row.has_unread,
  };
}

function mountPlan(qc: QueryClient) {
  const ws = fakeSocket();
  const unsubs = planChatSessionsSubscriptions(qc, ws, WS);
  return { ws, unsubs, dispose: () => unsubs.forEach((u) => u()) };
}

describe("an archive performed on another device reaches this phone's row", () => {
  function freshCache(): QueryClient {
    const qc = new QueryClient();
    qc.setQueryData<ChatSession[]>(chatKeys.sessions(WS), cachedBeforeArchive());
    return qc;
  }

  it("control: before the event the row leads history with a lit badge", () => {
    // The pre-condition the bug needs: the row IS cached before the archive
    // lands, badge lit. (That is the only window in which the bug is visible —
    // nothing refetches it afterwards.)
    expect(rendered(freshCache(), ARCHIVED_ELSEWHERE)).toEqual({
      bucket: "history",
      badge: 2,
      historyIndex: 0,
      archivedIndex: -1,
      tabBadge: 3,
      hasUnreadFlag: true,
    });
  });

  it("moves the row out of history into the archived bucket", () => {
    const qc = freshCache();
    const { ws, dispose } = mountPlan(qc);

    // Exactly what the server publishes on archive: status + updated_at, no
    // title/pinned/project_id (server/internal/handler/chat.go:639-644).
    ws.emit("chat:session_updated", {
      chat_session_id: ARCHIVED_ELSEWHERE,
      status: "archived",
      updated_at: "2026-10-15T11:00:00Z",
    });

    const after = rendered(qc, ARCHIVED_ELSEWHERE);
    expect(after.bucket).toBe("archived");
    expect(after.historyIndex).toBe(-1);
    expect(after.archivedIndex).toBe(0);

    // The other two rows must be untouched — an archive is not a re-bucket of
    // the whole list.
    const buckets = splitChatSessions(
      qc.getQueryData<ChatSession[]>(chatKeys.sessions(WS)) ?? [],
    );
    expect(buckets.history.map((s) => s.id)).toEqual([OTHERS[0], OTHERS[1]]);
    dispose();
  });

  it("clears the row's unread badge and its share of the Chat tab badge", () => {
    const qc = freshCache();
    const { ws, dispose } = mountPlan(qc);

    ws.emit("chat:session_updated", {
      chat_session_id: ARCHIVED_ELSEWHERE,
      status: "archived",
      updated_at: "2026-10-15T11:00:00Z",
    });

    const after = rendered(qc, ARCHIVED_ELSEWHERE);
    expect(after.badge).toBe(0);
    expect(after.hasUnreadFlag).toBe(false);
    // 3 → 1: only the OTHER session's single unread survives. This is the
    // assertion that catches "added `status` but forgot to zero": the row
    // would leave the history list yet the tab badge would still count it,
    // forever, since `countUnreadChatMessages` does not filter archived rows.
    expect(after.tabBadge).toBe(1);
    dispose();
  });

  it("unarchive returns the row to history WITHOUT fabricating unread", () => {
    const qc = freshCache();
    const { ws, dispose } = mountPlan(qc);

    ws.emit("chat:session_updated", {
      chat_session_id: ARCHIVED_ELSEWHERE,
      status: "archived",
      updated_at: "2026-10-15T11:00:00Z",
    });
    ws.emit("chat:session_updated", {
      chat_session_id: ARCHIVED_ELSEWHERE,
      status: "active",
      updated_at: "2026-10-15T12:00:00Z",
    });

    const after = rendered(qc, ARCHIVED_ELSEWHERE);
    expect(after.bucket).toBe("history");
    expect(after.historyIndex).toBe(0);
    // Whatever the cached unread was at that moment is what stands — the true
    // count arrives with the next server refetch (last_read_at untouched), so
    // resurrecting a number out of thin air would be a fresh lie.
    expect(after.badge).toBe(0);
    dispose();
  });

  it("applies project_id — including an explicit null, which detaches", () => {
    const qc = freshCache();
    qc.setQueryData<ChatSession[]>(chatKeys.sessions(WS), [
      session({ id: ARCHIVED_ELSEWHERE, project_id: "project-1" }),
    ]);
    const { ws, dispose } = mountPlan(qc);

    ws.emit("chat:session_updated", {
      chat_session_id: ARCHIVED_ELSEWHERE,
      project_id: null,
      updated_at: "2026-10-15T11:00:00Z",
    });

    expect(
      qc.getQueryData<ChatSession[]>(chatKeys.sessions(WS))?.[0]?.project_id,
    ).toBeNull();
    dispose();
  });

  it("leaves unread alone on a rename-only event, and still applies the title", () => {
    const qc = freshCache();
    const { ws, dispose } = mountPlan(qc);

    // A rename emits title + updated_at and nothing else — no status key at
    // all. Everything else must stay as cached.
    ws.emit("chat:session_updated", {
      chat_session_id: ARCHIVED_ELSEWHERE,
      title: "改了个名字",
      updated_at: "2026-10-15T11:00:00Z",
    });

    const rows = qc.getQueryData<ChatSession[]>(chatKeys.sessions(WS)) ?? [];
    const row = rows.find((s) => s.id === ARCHIVED_ELSEWHERE)!;
    expect(row.title).toBe("改了个名字");
    expect(row.status).toBe("active");
    expect(row.unread_count).toBe(2);
    expect(row.has_unread).toBe(true);
    expect(rendered(qc, ARCHIVED_ELSEWHERE).badge).toBe(2);
    dispose();
  });

  it("does not touch a different session's row", () => {
    const qc = freshCache();
    const { ws, dispose } = mountPlan(qc);

    ws.emit("chat:session_updated", {
      chat_session_id: ARCHIVED_ELSEWHERE,
      status: "archived",
      updated_at: "2026-10-15T11:00:00Z",
    });

    const other = rendered(qc, OTHERS[0]!);
    expect(other.bucket).toBe("history");
    expect(other.badge).toBe(1);
    dispose();
  });

  it("pinned-archive keeps the row pinned inside the archived bucket", () => {
    // Pin and status can both be set on one row; the bucket split must not
    // lose the pin, or the archived view's order diverges from the server's.
    const qc = freshCache();
    qc.setQueryData<ChatSession[]>(chatKeys.sessions(WS), [
      session({ id: ARCHIVED_ELSEWHERE, pinned: true, unread_count: 2 }),
      session({ id: OTHERS[0]!, updated_at: "2026-10-15T11:00:00Z" }),
    ]);
    const { ws, dispose } = mountPlan(qc);

    ws.emit("chat:session_updated", {
      chat_session_id: ARCHIVED_ELSEWHERE,
      status: "archived",
      pinned: true,
      updated_at: "2026-10-15T12:00:00Z",
    });

    const buckets = splitChatSessions(
      qc.getQueryData<ChatSession[]>(chatKeys.sessions(WS)) ?? [],
    );
    expect(buckets.archived.map((s) => s.id)).toEqual([ARCHIVED_ELSEWHERE]);
    expect(buckets.archived[0]?.pinned).toBe(true);
    dispose();
  });
});
