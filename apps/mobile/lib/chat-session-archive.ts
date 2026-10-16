/**
 * 本地「归档 / 取消归档」动作的缓存变更 —— 对齐 web 的
 * `useSetChatSessionArchived.onMutate` (`packages/core/chat/mutations.ts`)。
 *
 * 为什么它单独成模块，而不是留在 `data/mutations/chat.ts` 里：那个文件在顶层
 * 就拉进了 React Native（经 `@/lib/write-failure` 等），移动端 vitest 只有 Node
 * lane（`apps/mobile/vitest.config.ts`：「no DOM / RN native modules」），一旦
 * 从测试里 import 它，vitest 会在解析 RN 的 Flow 语法时就崩掉，纯函数根本跑不
 * 起来。同一套处理见 `lib/chat-queue-clear.ts`。
 *
 * 为什么归档必须清零未读：归档后的行的 `unread_count` 在服务端被强制为 0
 * （`server/pkg/db/queries/chat.sql:99-104`，注释自述「single source of truth
 * for all unread surfaces」），因为归档**故意不推进 `last_read_at`**（这样取消
 * 归档能还原真实未读），而归档行是只读的、残留未读无从清理。本地只翻 `status`
 * 的话，这一行会在 refetch 落地前**换成归档桶、却仍然亮着红点**，并且继续计入
 * Chat Tab 徽标 —— `countUnreadChatMessages` 直接累加 `unread_count` 且不过滤
 * archived (`packages/core/chat/unread.ts:21-31`)。窗口很短（`onSettled` 会
 * invalidate 重取），但与 WS 那条永不自愈的路径同理，没有理由留。
 *
 * 取消归档**不**凭空造一个未读数：真实值由 settle refetch 带回来
 * （`last_read_at` 未被触碰），照抄缓存里的现值才是诚实的。
 */
import type { ChatSession } from "@multica/core/types";

/**
 * web 另外还会盖上 `updated_at: nowIso` 并 `sortChatSessions`。移动端两处都不做，
 * 这是有意的、不是漏抄：
 *   - `updated_at`：本地造的时钟值只会决定「这一次 round-trip 期间归档桶里哪一行
 *     排第一」，而 `splitChatSessions` 每次渲染都会重排，refetch 落地后服务端自己
 *     的 `updated_at` 立刻取代它 —— 收益为零，代价是缓存里出现一个服务端从未有过的
 *     时间戳。
 *   - 重排：同上，渲染路径本来就重排，且这里改的是**同一个桶内**的顺序。
 */
export function setChatSessionArchivedPatch(
  prev: ChatSession[] | undefined,
  id: string,
  archived: boolean,
): ChatSession[] | undefined {
  return prev?.map((s) =>
    s.id === id
      ? {
          ...s,
          status: archived ? "archived" : "active",
          // has_unread 与 unread_count 一起清：行内红点读 unread_count
          // (`app/(app)/[workspace]/chat-sessions.tsx:119`)，Tab 徽标也累加它，
          // 只清 flag 会留下一个没有行内红点、却仍在 Tab 徽标里的幽灵。
          ...(archived ? { unread_count: 0, has_unread: false } : {}),
        }
      : s,
  );
}
