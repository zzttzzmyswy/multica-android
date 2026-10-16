/**
 * 本地归档动作在 refetch 落地前那一小段窗口里的表现（MYS-2183，次要缺口）。
 *
 * 主体缺口是 WS 侧（见 data/realtime/chat-session-archive-parity.test.ts）：别的
 * 设备归档之后手机那一行永不自愈。这里补的是**本机**点归档时的一小段窗口 ——
 * 请求发出到 `onSettled` 的 refetch 返回之间，那一行仍是服务端取数之前的本地态。
 *
 * 移动端原本只翻 `status`，而 web 的对应 mutation
 * (`packages/core/chat/mutations.ts:317-320`) 会同时清零未读，注释自述理由：
 * 「不留窗口」。不清零的话，这一行会在历史列表里换成归档桶、却仍然亮着红点，
 * 并且继续计入 Chat Tab 徽标（`countUnreadChatMessages` 不过滤 archived）。
 *
 * 断言在纯函数层：hook 本身要 renderer，而移动端 vitest 只有 Node lane
 * (`apps/mobile/vitest.config.ts`)。纯函数因此住在同名的 RN-free 模块里
 * (`lib/chat-session-archive.ts`)，而不是 `data/mutations/chat.ts` —— 后者顶层
 * 就拉进 React Native，Node lane 解析它的 Flow 语法会直接崩。同一套路见
 * `mutations/inbox-patches.test.ts` 与 `lib/chat-queue-clear.test.ts`。
 */
import { describe, expect, it, vi } from "vitest";
import type { ChatSession } from "@multica/core/types";
import { countUnreadChatMessages } from "@multica/core/chat/unread";
import { splitChatSessions } from "@/data/queries/chat";

// lib/chat-session-archive.ts is pure, but data/queries/chat.ts (for the
// bucket helper) transitively imports the native fetch client. Mock it so the
// Node lane never loads RN modules.
vi.mock("@/data/api", () => ({ api: {} }));

import { setChatSessionArchivedPatch } from "./chat-session-archive";

const TARGET = "session-target";
const OTHER = "session-other";

function session(over: Partial<ChatSession> & { id: string }): ChatSession {
  return {
    workspace_id: "ws-1",
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

/** The cached list right before the user taps 归档: the row has 2 unread. */
function before(): ChatSession[] {
  return [
    session({ id: TARGET, has_unread: true, unread_count: 2 }),
    session({ id: OTHER, has_unread: true, unread_count: 1 }),
  ];
}

describe("setChatSessionArchivedPatch", () => {
  it("moves the row to the archived bucket", () => {
    const out = setChatSessionArchivedPatch(before(), TARGET, true)!;
    const buckets = splitChatSessions(out);
    expect(buckets.history.map((s) => s.id)).toEqual([OTHER]);
    expect(buckets.archived.map((s) => s.id)).toEqual([TARGET]);
  });

  it("zeroes unread_count AND has_unread on archive", () => {
    // Both, not just the flag: the row's red dot reads `unread_count`
    // (app/(app)/[workspace]/chat-sessions.tsx:119) while the Chat tab badge
    // sums it too — clearing only `has_unread` leaves a lit badge behind.
    const out = setChatSessionArchivedPatch(before(), TARGET, true)!;
    const row = out.find((s) => s.id === TARGET)!;
    expect(row.unread_count).toBe(0);
    expect(row.has_unread).toBe(false);
    // And the aggregate that the Chat tab renders drops by exactly this row's
    // share — 3 → 1.
    expect(countUnreadChatMessages(out)).toBe(1);
    expect(countUnreadChatMessages(before())).toBe(3);
  });

  it("does not fabricate unread on unarchive", () => {
    // The true count comes back from the settle refetch (last_read_at is
    // untouched), so an unarchive must leave the cached fields as they stand
    // rather than resurrect a number.
    const archived = setChatSessionArchivedPatch(before(), TARGET, true)!;
    const out = setChatSessionArchivedPatch(archived, TARGET, false)!;
    const row = out.find((s) => s.id === TARGET)!;
    expect(row.status).toBe("active");
    expect(row.unread_count).toBe(0);
    expect(row.has_unread).toBe(false);
    expect(splitChatSessions(out).history.map((s) => s.id)).toEqual([
      TARGET,
      OTHER,
    ]);
  });

  it("touches only the target row", () => {
    const out = setChatSessionArchivedPatch(before(), TARGET, true)!;
    expect(out.find((s) => s.id === OTHER)).toEqual(
      before().find((s) => s.id === OTHER),
    );
  });

  it("returns undefined for an absent cache instead of inventing a list", () => {
    expect(setChatSessionArchivedPatch(undefined, TARGET, true)).toBeUndefined();
  });
});
