/**
 * Mobile chat mutations — create session, delete session, mark session read.
 *
 * Send-message is NOT a mutation: the chat screen runs a hand-written
 * optimistic burst (seed messages cache → seed pendingTask cache → flip
 * activeSession → POST → patch with real task_id) that doesn't map cleanly
 * onto useMutation. See the chat tab screen for the send path.
 *
 * Mirrors the optimistic-update + rollback + onSettled-invalidate pattern
 * of data/mutations/inbox.ts and web's packages/core/chat/mutations.ts.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  ChatPendingTask,
  ChatSession,
  PendingChatTasksResponse,
} from "@multica/core/types";
import { api } from "@/data/api";
import { useWorkspaceStore } from "@/data/workspace-store";
import { chatKeys, sortChatSessions } from "@/data/queries/chat";
import { EMPTY_CHAT_PENDING_TASK } from "@/data/schemas";
import {
  QUICK_ACTIONS_PENDING_TIMEOUT_MS,
  type ChatQuickActionsPendingState,
} from "@/lib/chat-quick-actions";

export function useCreateChatSession() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (data: { agent_id: string; title?: string }) =>
      api.createChatSession(data),
    onSettled: () => {
      // Optimistic prepend isn't done here — the chat screen seeds caches
      // synchronously around its send burst and uses the returned session
      // id directly. The invalidate ensures the dropdown picks up the new
      // row (and any has_unread / title server defaults) without a refetch
      // race on switch.
      qc.invalidateQueries({ queryKey: chatKeys.sessions(wsId) });
    },
  });
}

export function useDeleteChatSession() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (id: string) => api.deleteChatSession(id),
    onMutate: async (id) => {
      const key = chatKeys.sessions(wsId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ChatSession[]>(key);
      qc.setQueryData<ChatSession[]>(key, (old) =>
        old ? old.filter((s) => s.id !== id) : old,
      );
      return { prev, key };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: (_data, _err, id) => {
      qc.invalidateQueries({ queryKey: chatKeys.sessions(wsId) });
      // Detail-side caches the screen may still hold for this id.
      qc.removeQueries({ queryKey: chatKeys.messages(id) });
      qc.removeQueries({ queryKey: chatKeys.pendingTask(id) });
    },
  });
}

export function useMarkChatSessionRead() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (sessionId: string) => api.markChatSessionRead(sessionId),
    onMutate: async (sessionId) => {
      const key = chatKeys.sessions(wsId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ChatSession[]>(key);
      // Zero unread_count together with has_unread — the tab badge sums
      // unread_count (see lib/unread-counts.ts), so clearing only the flag
      // would leave a stale badge until the settle refetch. Mirrors web's
      // useMarkChatSessionRead in packages/core/chat/mutations.ts.
      qc.setQueryData<ChatSession[]>(key, (old) =>
        old?.map((s) =>
          s.id === sessionId
            ? { ...s, has_unread: false, unread_count: 0 }
            : s,
        ),
      );
      return { prev, key };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: chatKeys.sessions(wsId) });
    },
  });
}

export function useRenameChatSession() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      api.updateChatSession(id, { title }),
    onMutate: async ({ id, title }) => {
      const key = chatKeys.sessions(wsId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ChatSession[]>(key);
      qc.setQueryData<ChatSession[]>(key, (old) =>
        old?.map((s) => (s.id === id ? { ...s, title } : s)),
      );
      return { prev, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: chatKeys.sessions(wsId) });
    },
  });
}

/** Rebind (or clear) the session's durable project context. Mirrors web's
 *  `onProjectChange` path in chat-input.tsx — the server keeps the binding for
 *  every subsequent turn in the session. Optimistic so the composer chip
 *  updates on tap; the settle refetch reconciles the server row. */
export function useSetChatSessionProject() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: ({
      id,
      projectId,
    }: {
      id: string;
      projectId: string | null;
    }) => api.updateChatSession(id, { project_id: projectId }),
    onMutate: async ({ id, projectId }) => {
      const key = chatKeys.sessions(wsId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ChatSession[]>(key);
      qc.setQueryData<ChatSession[]>(key, (old) =>
        old?.map((s) => (s.id === id ? { ...s, project_id: projectId } : s)),
      );
      return { prev, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: chatKeys.sessions(wsId) });
    },
  });
}

export function useSetChatSessionPinned() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      api.setChatSessionPinned(id, pinned),
    onMutate: async ({ id, pinned }) => {
      const key = chatKeys.sessions(wsId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ChatSession[]>(key);
      // Flip the flag and re-sort immediately so a pin visibly jumps the row
      // to the top (and an unpin drops it back into activity order) without
      // waiting on the round-trip. Mirrors web's useSetChatSessionPinned.
      qc.setQueryData<ChatSession[]>(key, (old) =>
        old ? sortChatSessions(old.map((s) => (s.id === id ? { ...s, pinned } : s))) : old,
      );
      return { prev, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: chatKeys.sessions(wsId) });
    },
  });
}

export function useSetChatSessionArchived() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      api.setChatSessionArchived(id, archived),
    onMutate: async ({ id, archived }) => {
      const key = chatKeys.sessions(wsId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ChatSession[]>(key);
      // Flip status locally so the sheet row shows archived immediately;
      // the settle refetch reconciles flags the server derives.
      qc.setQueryData<ChatSession[]>(key, (old) =>
        old?.map((s) =>
          s.id === id
            ? { ...s, status: archived ? "archived" : "active" }
            : s,
        ),
      );
      return { prev, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: chatKeys.sessions(wsId) });
    },
  });
}

/**
 * Stop the in-flight task behind a session — the session list's "stop"
 * action, offered in place of "archive" while a turn is running (web
 * `chat-thread-list.tsx:301-311`).
 *
 * Not optimistic about the outcome, only about the *presentation*: the
 * pending-task row is dropped from both the aggregate and the per-session
 * cache immediately so the list stops showing "typing…" and re-offers
 * archive, and the messages query is refetched so the partial reply the
 * server keeps is what renders. A failure rolls the pending row back; the WS
 * lifecycle events reconcile either way.
 *
 * `cancelTaskById` takes no session id — a task id is globally unique — so
 * the session id is only used to locate the caches to patch.
 */
export function useStopChatTask() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: ({ taskId }: { taskId: string; sessionId: string }) =>
      api.cancelTaskById(taskId),
    onMutate: async ({
      taskId,
      sessionId,
    }: {
      taskId: string;
      sessionId: string;
    }) => {
      const aggregateKey = chatKeys.pendingTasks(wsId);
      const sessionKey = chatKeys.pendingTask(sessionId);
      await qc.cancelQueries({ queryKey: aggregateKey });
      await qc.cancelQueries({ queryKey: sessionKey });
      const prevAggregate =
        qc.getQueryData<PendingChatTasksResponse>(aggregateKey);
      const prevSession = qc.getQueryData<ChatPendingTask>(sessionKey);

      qc.setQueryData<PendingChatTasksResponse>(aggregateKey, (old) =>
        old
          ? {
              ...old,
              tasks: old.tasks.filter((task) => task.task_id !== taskId),
            }
          : old,
      );
      // The per-session cache holds the same task in a richer shape; the empty
      // object is the "nothing running" state the status pill and composer
      // read.
      qc.setQueryData<ChatPendingTask>(sessionKey, EMPTY_CHAT_PENDING_TASK);
      return { prevAggregate, prevSession, aggregateKey, sessionKey };
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx) return;
      if (ctx.prevAggregate !== undefined) {
        qc.setQueryData(ctx.aggregateKey, ctx.prevAggregate);
      }
      if (ctx.prevSession !== undefined) {
        qc.setQueryData(ctx.sessionKey, ctx.prevSession);
      }
    },
    onSettled: (_data, _err, { sessionId }) => {
      qc.invalidateQueries({ queryKey: chatKeys.pendingTasks(wsId) });
      qc.invalidateQueries({ queryKey: chatKeys.pendingTask(sessionId) });
      // The cancelled turn keeps its partial output server-side, so re-read
      // the window rather than leaving the optimistically-removed rows gone.
      qc.invalidateQueries({ queryKey: chatKeys.messages(sessionId) });
    },
  });
}

/**
 * Refresh the follow-up suggestions for a session's latest assistant turn.
 *
 * Optimistically raises the pending marker for that turn — its chips go inert
 * and the refresh control spins — and rolls it back on failure. The refreshed
 * pills arrive over `chat:quick_actions`, which clears the marker
 * (`applyChatQuickActionsToCache`); `useQuickActionsPendingTimeout` clears it
 * from the cache if that event never arrives.
 *
 * `retry: false` on purpose: a refresh is an explicit user action that spends
 * generation quota, and the server's 409s ("a newer reply arrived", "still
 * working") are not transient — retrying would just spend more.
 */
export function useRegenerateChatQuickActions() {
  const qc = useQueryClient();

  return useMutation({
    retry: false,
    mutationFn: ({
      sessionId,
      messageId,
    }: {
      sessionId: string;
      messageId: string;
    }) => api.regenerateChatQuickActions(sessionId, messageId),
    onMutate: ({ sessionId, messageId }) => {
      const key = chatKeys.quickActionsPending(sessionId);
      const previous =
        qc.getQueryData<ChatQuickActionsPendingState | null>(key);
      // The server confirms messageId IS the latest turn (else 409 → rollback),
      // so the marker's message_id is guaranteed to match the
      // chat:quick_actions that resolves it — no ack reconciliation needed.
      // task_id is unknown here and unused for resolution: the WS handler
      // matches on message_id.
      qc.setQueryData<ChatQuickActionsPendingState | null>(key, {
        message_id: messageId,
        task_id: "",
        expires_at: Date.now() + QUICK_ACTIONS_PENDING_TIMEOUT_MS,
      });
      return { previous, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) qc.setQueryData(ctx.key, ctx.previous ?? null);
    },
  });
}
