/**
 * ChatQueue 纯逻辑：从 pendingTask 提取排队任务行、判断 head 是否允许
 * Steer、解析编辑回填草稿。UI 层之外的查询都在这里，逻辑对齐 web
 * `chat-queue.tsx` 的 canSendNow 与 `queue.fallback` 兜底约定。
 */
import type { ChatPendingTask, ChatQueuedTask } from "@multica/core/types";

/** Head 状态允许「立即发送」（Steer）的集合 —— 对齐 web chat-queue.tsx
 *  `canSendNow = headStatus === dispatched|running|waiting_local_directory`。 */
const STEERABLE_HEAD_STATUSES = new Set([
  "dispatched",
  "running",
  "waiting_local_directory",
]);

export function queueRows(
  pendingTask: ChatPendingTask | null | undefined,
): ChatQueuedTask[] {
  return pendingTask?.queued_tasks ?? [];
}

export function canSteer(
  pendingTask: ChatPendingTask | null | undefined,
): boolean {
  return (
    pendingTask?.status !== undefined &&
    STEERABLE_HEAD_STATUSES.has(pendingTask.status)
  );
}

/** 编辑回填的草稿正文；空内容返回 null，由调用方用 `chat.queue.fallback`
 *  占位文案兜底（web `t($ => $.queue.fallback)`）。 */
export function queueEditDraftText(task: ChatQueuedTask): string | null {
  const trimmed = task.content?.trim();
  return trimmed ? trimmed : null;
}