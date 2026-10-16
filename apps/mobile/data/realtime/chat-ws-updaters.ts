/**
 * Mobile-owned WS cache patchers for the chat domain.
 *
 * Pure functions over QueryClient — no React, no WS plumbing. The
 * `use-chat-sessions-realtime` and `use-chat-session-realtime` hooks
 * translate WS events into calls into this module.
 *
 * Why mobile-owned (and not importing from web's chat ws-updaters):
 *   - Web binds its updaters to `chatKeys` from packages/core/chat/queries.ts,
 *     a different runtime instance than mobile's data/queries/chat.ts. Keys
 *     are compared structurally so it'd *appear* to work, but binding cache
 *     mutation to a foreign key factory invites silent drift the moment
 *     either side adjusts its key shape.
 *   - Mobile has a smaller cache surface (no taskMessages live timeline in
 *     v1, no per-user pending-tasks aggregate).
 *
 * Cache shapes (the design contract):
 *   - chatKeys.sessions(wsId)       → ChatSession[]
 *   - chatKeys.messages(sessionId)  → ChatMessage[]   (flat, ASC oldest→newest)
 *   - chatKeys.pendingTask(sessionId)→ ChatPendingTask (empty `{}` = no in-flight)
 */
import type { QueryClient } from "@tanstack/react-query";
import {
  enqueuePendingChatTask,
  removePendingChatTask,
} from "@multica/core/chat/pending";
import type {
  ChatDonePayload,
  ChatCancelFinalizedPayload,
  ChatMessage,
  ChatPendingTask,
  ChatQuickActionsPayload,
  ChatSession,
  ChatSessionDeletedPayload,
  TaskMessagePayload,
  TaskQueuedPayload,
  TaskDispatchPayload,
} from "@multica/core/types";
import { chatKeys, sortChatSessions } from "@/data/queries/chat";
import type { ChatQuickActionsPendingState } from "@/lib/chat-quick-actions";
import { planCancelFinalized } from "@/lib/chat-draft-restore";

// =====================================================
// Sessions list (ChatSession[] keyed by wsId)
// =====================================================

/**
 * Payload of a `chat:session_updated` event (MYS-2183).
 *
 * The server's `protocol.ChatSessionUpdatedPayload` declares every field
 * optional-but-meaningful, and the three non-title ones are each set by
 * exactly ONE write path (`server/internal/handler/chat.go`):
 *
 *   - `pinned`     — pin/unpin only
 *   - `status`     — archive/unarchive only ("active" | "archived")
 *   - `project_id` — project-context update only, and it is a `**string`
 *                    server-side precisely so an explicit JSON `null` means
 *                    "detach the project" while an absent key means "untouched"
 *   - `updated_at` — always sent
 *
 * So absence is load-bearing: a sparse payload (rename emitted `title` +
 * `updated_at` alone) must leave the other fields as cached. Kept mobile-owned
 * rather than added to `packages/core/types/events.ts`, whose map still types
 * this event as `unknown` by design ("no formal payload interfaces yet —
 * clients consume as opaque triggers"); web narrows the same shape inline in
 * `packages/core/realtime/use-realtime-sync.ts`.
 */
export interface ChatSessionUpdatedPayload {
  chat_session_id: string;
  title?: string;
  project_id?: string | null;
  pinned?: boolean;
  status?: "active" | "archived";
  updated_at?: string;
}

/**
 * Patch one session row from a `chat:session_updated` event and re-sort the
 * list. The event carries whatever changed (title for renames, `pinned` for
 * pin/unpin, `status` for archive/unarchive, `project_id` for a context
 * switch) — fields absent from the payload are left untouched so a sparse
 * payload can't clobber the client's view.
 *
 * Why ALL of those fields and not just the three this used to apply: web's
 * `applyChatSessionUpdatedToCache` (packages/core/realtime/use-realtime-sync.ts)
 * applies the same set, and `chatSessionsOptions` is `staleTime: Infinity` on
 * both platforms — nothing refetches on its own, so a field this handler drops
 * stays wrong for the life of the connection. The missing `status` was the
 * visible one: `splitChatSessions` buckets history vs archived on `status`
 * locally, so an archive performed on another device/web left the row sitting
 * in the phone's history list, badge lit.
 *
 * Archiving must also zero the row's unread here. The server emits only
 * `status`/`updated_at`, and `ListAllChatSessionsByCreator` forces
 * `unread_count = 0` for archived rows (server/pkg/db/queries/chat.sql:99-104,
 * "single source of truth for all unread surfaces") — so a surviving count is
 * uncleanable (SendChatMessage refuses archived sessions) and keeps the row's
 * dot lit plus its share of the Chat tab badge
 * (`countUnreadChatMessages` sums `unread_count` without filtering archived).
 * Same MUL-4360 stuck-badge bug, one surface over. Unarchive does NOT
 * fabricate a count — the true state arrives with the next server refetch
 * (last_read_at is untouched), so `active` leaves the unread fields as cached.
 *
 * The sort, unlike web's, is UNCONDITIONAL and that is deliberate, not drift.
 * Mobile's `sortChatSessions` ranks by `last_message.created_at` with
 * `updated_at` as the fallback, which is exactly the server's own
 * `ORDER BY … COALESCE(lm.created_at, cs.updated_at) DESC` — so re-sorting
 * after every patch converges on the row order a refetch would produce. Web
 * skips the sort on a rename to avoid the row jumping under the pointer; on a
 * phone the list is not under a pointer while the event lands (the sheet is
 * either open over a *different* device's change or not mounted), and matching
 * server order is the stronger guarantee. Pinned sessions still hoist and
 * archived ones still leave the history bucket either way.
 */
export function patchSessionListAfterUpdate(
  qc: QueryClient,
  wsId: string | null,
  payload: ChatSessionUpdatedPayload,
) {
  qc.setQueryData<ChatSession[]>(chatKeys.sessions(wsId), (old) => {
    if (!old) return old;
    const next = old.map((s) =>
      s.id === payload.chat_session_id
        ? {
            ...s,
            ...(payload.title !== undefined ? { title: payload.title } : {}),
            // Presence, NOT value: the server signals "detach the project" with
            // an explicit null, so `!== undefined` would read that null as
            // "field absent" and silently keep the old binding.
            ...("project_id" in payload
              ? { project_id: payload.project_id }
              : {}),
            ...(payload.pinned !== undefined
              ? { pinned: payload.pinned }
              : {}),
            ...(payload.status !== undefined ? { status: payload.status } : {}),
            ...(payload.updated_at !== undefined
              ? { updated_at: payload.updated_at }
              : {}),
            ...(payload.status === "archived"
              ? { unread_count: 0, has_unread: false }
              : {}),
          }
        : s,
    );
    return sortChatSessions(next);
  });
}

export function dropSessionFromList(
  qc: QueryClient,
  wsId: string | null,
  payload: ChatSessionDeletedPayload,
) {
  qc.setQueryData<ChatSession[]>(chatKeys.sessions(wsId), (old) =>
    old?.filter((s) => s.id !== payload.chat_session_id),
  );
  qc.removeQueries({ queryKey: chatKeys.messages(payload.chat_session_id) });
  qc.removeQueries({
    queryKey: chatKeys.pendingTask(payload.chat_session_id),
  });
}

export function flipSessionUnread(
  qc: QueryClient,
  wsId: string | null,
  sessionId: string,
  hasUnread: boolean,
) {
  qc.setQueryData<ChatSession[]>(chatKeys.sessions(wsId), (old) =>
    old?.map((s) =>
      s.id === sessionId ? { ...s, has_unread: hasUnread } : s,
    ),
  );
}

// =====================================================
// Messages cache (ChatMessage[] keyed by sessionId)
// =====================================================

/**
 * Apply `chat:done` to the messages cache.
 *
 * When the payload carries the freshly-persisted assistant message inline
 * (message_id + content + created_at), patch the cache directly so the
 * assistant bubble lands in the same render tick that clears pendingTask
 * — no live-timeline → final-bubble flicker.
 *
 * Older servers (pre-#2123 in web's commit history) sent only chat_session_id
 * + task_id. Detect that and fall back to invalidate; we'll refetch the
 * messages list and accept a one-frame window with no bubble.
 *
 * The inline patch never carries attachments: `ChatDonePayload` has no
 * attachments field by contract, yet an assistant reply may have images/files
 * bound to it server-side. So after the inline patch we ALWAYS invalidate the
 * messages list to refetch the authoritative rows (which include
 * `attachments`). Mirrors web's `use-realtime-sync.ts`, which invalidates
 * unconditionally after its inline patch. The patch is kept purely for the
 * instant, flicker-free bubble; the refetch is what makes attachments appear.
 */
export function applyChatDoneToCache(
  qc: QueryClient,
  payload: ChatDonePayload,
) {
  if (
    payload.message_id &&
    (payload.content != null || (payload.quick_actions?.length ?? 0) > 0) &&
    payload.created_at
  ) {
    const assistantMsg: ChatMessage = {
      id: payload.message_id,
      chat_session_id: payload.chat_session_id,
      role: "assistant",
      content: payload.content ?? "",
      task_id: payload.task_id,
      created_at: payload.created_at,
      elapsed_ms: payload.elapsed_ms ?? null,
      // Mirror web's applyChatDoneToCache: carry the kind so a no_response turn
      // renders its notice inline; missing → "message" for older servers
      // (MUL-4351).
      message_kind: payload.message_kind ?? "message",
      ...(payload.quick_actions !== undefined
        ? { quick_actions: payload.quick_actions }
        : {}),
    };
    qc.setQueryData<ChatMessage[]>(
      chatKeys.messages(payload.chat_session_id),
      (old) => {
        if (!old) return [assistantMsg];
        // Echo guard — server may re-emit on reconnect.
        if (old.some((m) => m.id === assistantMsg.id)) return old;
        return [...old, assistantMsg];
      },
    );
  }
  // Refetch the authoritative message list so any attachments bound to the
  // assistant reply (absent from the event payload) are pulled in.
  qc.invalidateQueries({
    queryKey: chatKeys.messages(payload.chat_session_id),
  });
  // A queued successor may already exist. Refetch the server-authoritative
  // head instead of clearing it and briefly presenting the session as idle.
  invalidatePendingTask(qc, payload.chat_session_id);
}

/**
 * Apply a `chat:quick_actions` supplement to the messages cache.
 *
 * The daemon generates quick actions in a background pass AFTER the turn
 * finishes, so they arrive on their own event well after `chat:done` already
 * invalidated + refetched the messages list (which came back with none). With
 * `staleTime: Infinity` nothing refetches again, so without this patch an
 * active mobile session would never render async-generated quick actions until
 * a manual pull-to-refresh or refocus.
 *
 * Patch the identified assistant message's `quick_actions` in place. The
 * payload's list is already server-validated, so — like web — this only
 * patches; no invalidate (mobile's cellular "patch over invalidate" rule). An
 * empty/missing list is terminal ("no suggestions this turn") and a no-op:
 * the message already renders no chips.
 *
 * Mirrors web's `applyChatQuickActionsToCache` in
 * packages/core/realtime/use-realtime-sync.ts. Mobile has a single flat
 * messages cache and no pending-placeholder marker, so it patches only that
 * one cache.
 */
export async function applyChatQuickActionsToCache(
  qc: QueryClient,
  payload: ChatQuickActionsPayload,
) {
  const actions = payload.quick_actions ?? [];
  if (actions.length === 0) return;
  // chat:done's invalidate may still have a messages refetch in flight that
  // read the assistant row BEFORE the daemon persisted these actions. Cancel it
  // first so its actions-less response can't land after — and overwrite — the
  // patch below. The messages query is staleTime: Infinity, so such an overwrite
  // would never self-heal (MUL-5149 stale-refetch race). Cancel before
  // setQueryData: cancelQueries reverts to the pre-fetch state, so patching
  // first would be undone by the revert.
  await qc.cancelQueries({
    queryKey: chatKeys.messages(payload.chat_session_id),
  });
  qc.setQueryData<ChatMessage[]>(
    chatKeys.messages(payload.chat_session_id),
    (old) =>
      old?.map((m) =>
        m.id === payload.message_id ? { ...m, quick_actions: actions } : m,
      ),
  );
  // Resolve the pending marker — but only when it belongs to THIS message: a
  // late supplement for turn N must not clear the marker that turn N+1's
  // chat:done just raised. Mirrors web's `applyChatQuickActionsToCache`.
  qc.setQueryData<ChatQuickActionsPendingState | null>(
    chatKeys.quickActionsPending(payload.chat_session_id),
    (current) =>
      current && current.message_id !== payload.message_id ? current : null,
  );
}

// =====================================================
// Pending task (ChatPendingTask keyed by sessionId)
// =====================================================

export function seedPendingTaskFromQueued(
  qc: QueryClient,
  payload: TaskQueuedPayload,
) {
  if (!payload.chat_session_id) return;
  // A follow-up can be queued while another task is active. The event does
  // not carry enough queue state to replace that active head safely.
  invalidatePendingTask(qc, payload.chat_session_id);
}

export function promotePendingTaskToRunning(
  qc: QueryClient,
  payload: TaskDispatchPayload,
) {
  if (!payload.chat_session_id) return;
  qc.setQueryData<ChatPendingTask>(
    chatKeys.pendingTask(payload.chat_session_id),
    (old) => {
      // Only upgrade if it's the task we already know about. A stale
      // dispatch event for a finished task shouldn't reanimate the pill.
      if (!old || old.task_id !== payload.task_id) return old;
      return { ...old, status: "running" };
    },
  );
  invalidatePendingTask(qc, payload.chat_session_id);
  qc.invalidateQueries({
    queryKey: chatKeys.messages(payload.chat_session_id),
  });
}

export function invalidatePendingTask(
  qc: QueryClient,
  sessionId: string,
) {
  qc.invalidateQueries({ queryKey: chatKeys.pendingTask(sessionId) });
}

export function seedAcceptedPendingTask(
  qc: QueryClient,
  payload: {
    chat_session_id: string;
    task_id: string;
    created_at: string;
    message_id?: string;
    content?: string;
    optimistic_task_id?: string;
    supports_queue?: boolean;
    queued?: boolean;
  },
) {
  qc.setQueryData<ChatPendingTask>(
    chatKeys.pendingTask(payload.chat_session_id),
    (old) => {
      const task = {
        task_id: payload.task_id,
        status: "queued",
        created_at: payload.created_at,
        ...(payload.message_id ? { message_id: payload.message_id } : {}),
        ...(payload.content !== undefined ? { content: payload.content } : {}),
      };
      let next: ChatPendingTask;
      if (
        payload.queued === true &&
        payload.optimistic_task_id &&
        old?.task_id === payload.optimistic_task_id
      ) {
        // The server knows an authoritative predecessor exists, but this
        // client has not loaded it yet. Retain the optimistic root as a
        // non-network placeholder until the invalidation fills that head;
        // dropping it here would briefly unlock the composer and remove the
        // status line while leaving only a queue row.
        next = enqueuePendingChatTask(old, task, true);
      } else {
        const reconciled = payload.optimistic_task_id
          ? removePendingChatTask(old, payload.optimistic_task_id)
          : old;
        next = enqueuePendingChatTask(reconciled, task, payload.queued);
      }
      if (payload.supports_queue === true || old?.supports_queue === true) {
        next.supports_queue = true;
      }
      return next;
    },
  );
  invalidatePendingTask(qc, payload.chat_session_id);
}

// =====================================================
// Task messages (live timeline, keyed by taskId)
// =====================================================

/**
 * Append a `task:message` payload into the per-task timeline cache.
 *
 * - De-dupes on `seq` (server may re-emit on flaky network).
 * - Sorts by `seq` ASC after insert so reordered late-arriving rows still
 *   render in execution order.
 * - Creates the cache entry on first event (empty default), so the timeline
 *   is visible even before the user opens the assistant bubble that drives
 *   the lazy fetch.
 *
 * Mirrors `packages/core/realtime/use-realtime-sync.ts` ~675-689 (web's
 * single global handler). Mobile attaches per-session via
 * `use-chat-session-realtime` instead — see the WS strategy note in
 * `apps/mobile/CLAUDE.md` for why mobile prefers per-record mounts.
 */
export function appendTaskMessage(
  qc: QueryClient,
  payload: TaskMessagePayload,
) {
  qc.setQueryData<TaskMessagePayload[]>(
    chatKeys.taskMessages(payload.task_id),
    (old = []) => {
      if (old.some((m) => m.seq === payload.seq)) return old;
      return [...old, payload].sort((a, b) => a.seq - b.seq);
    },
  );
}

// =====================================================
// Cancelled-prompt restores (#5219)
// =====================================================

/**
 * Drop one message from a session's caches.
 *
 * A cancellation on the legacy branch deletes the user's prompt server-side and
 * a deferred one settles as `restored` — in both cases the bubble is gone for
 * real, so leaving it on screen would render a prompt that no longer exists
 * (and whose re-send the user is about to make from the restored draft). The
 * paginated cursor is untouched: the row left the middle of the window, not the
 * window's edge.
 *
 * Mirrors web's `removeChatMessageFromCaches` (packages/core/realtime).
 */
export function removeChatMessageFromCache(
  qc: QueryClient,
  sessionId: string,
  messageId: string,
) {
  qc.setQueryData<ChatMessage[]>(chatKeys.messages(sessionId), (old) =>
    old ? old.filter((m) => m.id !== messageId) : old,
  );
}

/**
 * Apply a `chat:cancel_finalized` event (#5219) — the deferred outcome of a
 * cancelled chat task, settled after the daemon's transcript flush.
 *
 *   - outcome "stopped": a late "Stopped." assistant row was persisted; insert
 *     it exactly like a chat:done message.
 *   - outcome "restored": the triggering user message was deleted — drop it from
 *     the cache. The deleted prompt itself never rides this workspace-wide
 *     broadcast (it is durable server-side and only the initiator's client reads
 *     it through the creator-authorized draft-restores endpoint), so the only
 *     local work is eviction plus an invalidation hint.
 *
 * The draft-restores invalidation is gated to the task's initiator and fails
 * closed when `initiator_user_id` is missing — nothing is lost either way,
 * because the durable row is fetched again on the next composer mount or
 * network reconnect. Mirrors web's `applyChatCancelFinalizedToCache`.
 */
export function applyChatCancelFinalizedToCache(
  qc: QueryClient,
  payload: ChatCancelFinalizedPayload,
  currentUserId?: string,
) {
  const sessionId = payload.chat_session_id;
  if (!sessionId) return;
  const plan = planCancelFinalized({
    outcome: payload.outcome,
    chatSessionId: sessionId,
    taskId: payload.task_id,
    messageId: payload.message_id,
    initiatorUserId: payload.initiator_user_id,
    currentUserId,
  });
  if (payload.outcome === "stopped") {
    applyChatDoneToCache(qc, {
      chat_session_id: sessionId,
      task_id: payload.task_id,
      message_id: payload.message_id,
      content: payload.content,
      elapsed_ms: payload.elapsed_ms,
      created_at: payload.created_at,
      message_kind: payload.message_kind,
    });
    return;
  }
  if (plan.removeMessageId) {
    removeChatMessageFromCache(qc, sessionId, plan.removeMessageId);
  }
  // Deferred finalization can arrive after a queued successor was promoted.
  // Remove only the cancelled task so a late restore cannot hide newer work.
  qc.setQueryData<ChatPendingTask>(
    chatKeys.pendingTask(sessionId),
    (old) => removePendingChatTask(old, payload.task_id),
  );
  qc.invalidateQueries({ queryKey: chatKeys.messages(sessionId) });
  qc.invalidateQueries({ queryKey: chatKeys.pendingTask(sessionId) });
  if (plan.refetchDraftRestores) {
    void qc.invalidateQueries({ queryKey: chatKeys.draftRestores(sessionId) });
  }
}
