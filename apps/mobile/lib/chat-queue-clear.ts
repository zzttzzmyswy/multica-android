/**
 * 「清空排队」的缓存收尾 —— 对齐 web 的 `handleClearQueuedTasks`
 * (`packages/views/chat/components/use-chat-task-actions.ts:159-184`)。
 *
 * 为什么这不是一句 `patchPending(queued_tasks: [])` 就够的：
 *
 *   对话列表渲染的是 `hideQueuedChatMessages(messages, pendingTask)`
 *   (`packages/core/chat/pending.ts`) —— 它按 `queued_tasks` 的
 *   `message_id → task_id` 把**排队中的那些气泡从列表里滤掉**，而这些气泡
 *   本体一直躺在扁平的 `chatKeys.messages(sessionId)` 缓存里（发送时的乐观
 *   气泡写入的就是这里）。所以一旦把 `queued_tasks` 置空，过滤条件随之消失，
 *   服务端**已经删掉**的消息会原地重新冒出来，并且因为只失效了
 *   `pendingTask`、没有失效 `messages`，它们会一直挂在屏幕上。
 *
 * web 正是为此在那里逐条 `removeChatMessageFromCaches`。移动端这一层原本
 * 缺失，本模块补上，并且把 web 里靠时序侥幸成立的部分收紧：
 *
 *   - 待删清单在**发请求之前**就从缓存里取好。web 是请求返回后才读
 *     `pending.queued_tasks`，中间若有一次 pending 轮询/WS 落下来把队列清掉，
 *     它读到的就是空清单 —— 那是个「能过类型检查、却什么都没删」的形态。
 *     移动端的 pendingTask 带 `refetchInterval` 轮询，这条竞态是真实存在的。
 *   - 先摘气泡，再清 `queued_tasks`。反过来的话，被隐藏的气泡会有一次
 *     「先现形、再消失」的闪烁。
 *   - `finally` 里同时失效 `pendingTask` 与 `messages`。失效 `messages` 是**补**
 *     而不是**删**：`chatMessagesOptions` 的 queryFn 走
 *     `mergeNewestMessages`，按 id 只增不减（保滚回历史的窗口），所以服务端
 *     仍留着的行（未认领的头任务、被 `deferred` 挡住而没被取消的后续任务）能
 *     被补回来，但**已经删掉的行它永远摘不掉** —— 真正让删除可见的就是上面那句
 *     逐条摘除。这也是为什么 `finally` 只失效 `pendingTask` 的旧写法必然会
 *     留下幽灵气泡：既没人摘，也没有任何重取能摘。
 *   - 分页游标 `messagesPage` **不**失效：它是纯客户端的游标槽位，游标指向
 *     更旧的一页，而被清掉的是最尾部的一批消息，窗口边缘没动。web 能失效
 *     是因为它的 `messagesPage` 是 infinite query；移动端照搬会把游标重置。
 */
import type { QueryClient } from "@tanstack/react-query";
import type { ChatPendingTask } from "@multica/core/types";
import { removePendingChatTask } from "@multica/core/chat/pending";
import { api } from "@/data/api";
import { chatKeys } from "@/data/queries/chat";
import { removeChatMessageFromCache } from "@/data/realtime/chat-ws-updaters";

/**
 * 清空会删掉哪些气泡 —— 待删清单必须在 `queued_tasks` 被置空**之前**取。
 *
 * 只取带 `message_id` 的任务：没有 `message_id` 的排队任务（老服务端、或
 * 尚未回填 message id 的行）没有对应的气泡可摘。
 */
export function queuedMessageIdsToEvict(
  pending: ChatPendingTask | undefined,
): string[] {
  return (pending?.queued_tasks ?? []).flatMap((task) =>
    task.message_id ? [task.message_id] : [],
  );
}

/**
 * 把排队后续任务从 pending 缓存里摘掉，保留头任务。
 *
 * 逐条 `removePendingChatTask` 与 web 的 reduce 逐字对齐；语义上等价于
 * `queued_tasks: []`，但走同一个归约器，`supports_queue` 的保留规则只有一处。
 *
 * 头任务必须留下：服务端 `CancelQueuedAgentTasksForSession`
 * (`server/pkg/db/queries/agent.sql`) 只取消**非头**的 `status='queued'` 行，
 * 未认领的 FIFO 头是「当前这一轮」，它的消息也还在。
 */
export function clearQueuedTasksInPending(
  old: ChatPendingTask | undefined,
): ChatPendingTask {
  return (old?.queued_tasks ?? []).reduce<ChatPendingTask>(
    (current, task) => removePendingChatTask(current, task.task_id),
    old ?? {},
  );
}

/**
 * 清空会话的排队任务，并把这一步牵动的所有缓存一起收尾。
 *
 * 失败时**不**摘任何气泡、**不**清 `queued_tasks`，并且把错误抛出去，由调用方
 * （`ChatQueue` 的 `run()`）弹 `chat.queue.actionFailed` —— 与 web 在 catch 里
 * `toast.error` 等价。无论成败，`finally` 都会让 pendingTask 与 messages 重新
 * 对齐服务端事实。
 */
export async function clearChatQueue(
  qc: QueryClient,
  sessionId: string,
  wsId?: string | null,
): Promise<void> {
  const pendingKey = chatKeys.pendingTask(sessionId);
  // 1. 先切断在途的 pending 重取（web 同序），否则它在清空后落地会把
  //    已经删掉的排队任务又写回缓存。
  await qc.cancelQueries({ queryKey: pendingKey });
  // 2. 请求前取好待删清单 —— 这是本函数唯一能保证「删的是用户看到的那批」的时刻。
  const doomedMessageIds = queuedMessageIdsToEvict(
    qc.getQueryData<ChatPendingTask>(pendingKey),
  );
  try {
    await api.clearQueuedChatTasks(sessionId);
    // 3. 先摘气泡（服务端已删），再清队列，避免被隐藏的气泡闪一下再消失。
    for (const messageId of doomedMessageIds) {
      removeChatMessageFromCache(qc, sessionId, messageId);
    }
    qc.setQueryData<ChatPendingTask>(pendingKey, (old) =>
      clearQueuedTasksInPending(old),
    );
  } catch (err) {
    console.warn("[chat] clear queued tasks failed", { sessionId, err });
    throw err;
  } finally {
    qc.invalidateQueries({ queryKey: pendingKey });
    qc.invalidateQueries({ queryKey: chatKeys.messages(sessionId) });
    if (wsId) {
      qc.invalidateQueries({ queryKey: chatKeys.pendingTasks(wsId) });
    }
  }
}
