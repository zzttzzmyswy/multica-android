/**
 * Chat cancellation → draft restore: the pure decisions.
 *
 * Cancelling a chat task that the daemon already claimed but has not yet
 * answered deletes the user's own prompt server-side. The server holds the
 * text in one of two places depending on what the *client* declared:
 *
 *   - Declared `X-Client-Capabilities: chat-draft-restore-v1` and the task had
 *     started → the empty/non-empty judgment is deferred until the daemon
 *     acks its transcript flush; the prompt is written to a durable
 *     `chat_draft_restore` row and the cancel response carries NO
 *     `cancelled_chat_message`. The client collects the row from
 *     `GET /api/chat/sessions/:id/draft-restores` and consumes it (idempotent
 *     DELETE) once its composer holds the text.
 *   - Anything else → the legacy synchronous branch: the prompt is deleted
 *     immediately and its content rides back in THIS response's
 *     `cancelled_chat_message`. There is no second copy.
 *
 * Both paths lose the prompt if the client reads neither, which is where the
 * mobile app stood: it sent no capability header and `cancelTaskById` was typed
 * `Promise<void>`, so the response body — the only surviving copy on the legacy
 * branch — was discarded.
 *
 * This module holds the decisions as pure functions so the Node vitest lane can
 * exercise them without React or native modules. Mirrors the web state machine
 * in `packages/views/chat/components/use-chat-draft-restore.ts` and the
 * response handling in `.../use-chat-task-actions.ts`.
 */
import type { Attachment, ChatDraftRestore } from "@multica/core/types";

/**
 * The capability token the server gates deferred cancellation on
 * (`protocol.AppCapabilityChatDraftRestoreV1`, read by
 * `server/internal/handler/chat.go`). Same literal as web's
 * `CHAT_DRAFT_RESTORE_CAPABILITY` (packages/core/api/client.ts) — the server
 * compares the exact string, so the two clients cannot drift.
 */
export const CHAT_DRAFT_RESTORE_CAPABILITY = "chat-draft-restore-v1";

/**
 * A draft the composer is asked to adopt. Two sources feed it:
 *   - a durable deferred-cancellation row (`serverRestoreId` set);
 *   - a synchronous restore from the cancel response, or a failed send — no
 *     server copy left, so `serverRestoreId` is absent and its text lives only
 *     in the persisted per-session queue.
 */
export interface RestoreDraftRequest {
  id: string;
  content: string;
  attachments?: Attachment[];
  /**
   * Draft slot this restore targets. The composer applies it only while the
   * user is viewing that session, so a restore never lands in the wrong chat.
   */
  sessionId?: string;
  /** Set for durable restores: the row to delete once the draft is applied. */
  serverRestoreId?: string;
}

/** A server-less restore waiting for its session's composer. */
export interface PendingSendRestore {
  id: string;
  content: string;
  attachments?: Attachment[];
  /** Never empty — a restore always belongs to a session. */
  sessionId: string;
}

/**
 * What the owner decides about the current restore request.
 *
 * Only `apply` is terminal; everything else leaves the request pending so it is
 * re-offered on the next render / fetch — a skipped hand-off that got marked
 * done would strand the user's prompt for the life of the composer.
 *
 * Deliberately says nothing about whether the composer currently holds work in
 * progress. That check lives in the composer itself
 * (`MessageComposer`'s restore effect), because only it knows its own
 * attachments and mention chips, and routing that knowledge back up to the owner
 * as state closes a render loop: owner state → hook deps → verdict → prop →
 * composer effect → owner state. The composer simply declines to apply and the
 * request stays pending, which is the same WAIT with no cycle.
 */
export type RestoreApplication =
  /** No request, or one already applied by this composer. */
  | "idle"
  /** Addressed at a session the user is not looking at — keep waiting. */
  | "wait-session"
  /** Hand it to the composer, which applies it only if it is not busy. */
  | "apply";

/**
 * Decide whether the composer may adopt `request` right now.
 *
 * Mirrors web's `chat-input.tsx` restore effect's session and ledger guards. The
 * "user is typing" guard is the composer's (see `RestoreApplication`).
 */
export function decideRestoreApplication(args: {
  request: RestoreDraftRequest | null;
  draftKey: string;
  /** Ledger ids already written into a composer (durable restores only). */
  appliedRestoreIds: readonly string[];
}): RestoreApplication {
  const { request } = args;
  if (!request) return "idle";
  // A durable restore whose consume never landed is still in the ledger. The
  // ledger — not the server row — is what makes the offer at-most-once: the row
  // may still be on the server, so re-offering it would let the user send a
  // prompt they already sent.
  if (
    request.serverRestoreId &&
    args.appliedRestoreIds.includes(request.serverRestoreId)
  ) {
    return "idle";
  }
  // Session-scoped: a fire-and-forget send that failed after the user navigated
  // away must not dump its content into the session they are looking at now.
  if (request.sessionId && request.sessionId !== args.draftKey) {
    return "wait-session";
  }
  return "apply";
}

/**
 * The durable restore a composer should offer: the session's own row, not one
 * already applied here. Rows for other sessions (or the same row arriving for a
 * second commit) are skipped by the caller re-running this on every fetch.
 */
export function pickPendingRestore(
  restores: readonly ChatDraftRestore[] | undefined,
  sessionId: string,
  appliedRestoreIds: readonly string[],
): ChatDraftRestore | null {
  const match = (restores ?? []).find(
    (r) =>
      r.chat_session_id === sessionId && !appliedRestoreIds.includes(r.id),
  );
  return match ?? null;
}

/**
 * Rows whose consume never landed: already applied locally, still on the
 * server. Firing the idempotent DELETE again on every fetch until they are gone
 * is what closes the lost-consume hole — without it a prompt the user sent
 * would be offered again after a restart.
 */
export function pickRestoresToReconcile(
  restores: readonly ChatDraftRestore[] | undefined,
  sessionId: string,
  appliedRestoreIds: readonly string[],
): ChatDraftRestore[] {
  return (restores ?? []).filter(
    (r) =>
      r.chat_session_id === sessionId && appliedRestoreIds.includes(r.id),
  );
}

// ---------------------------------------------------------------------------
// Applied ledger
// ---------------------------------------------------------------------------

/**
 * Record a durable restore as written into a composer.
 *
 * Append-only with no cap, matching web: every entry is an UNCONFIRMED consume,
 * and evicting one silently re-arms the restore it suppresses — the row is
 * still on the server, so the next fetch would offer an already-sent prompt a
 * second time. Entries leave only through `forgetAppliedRestore`.
 */
export function markRestoreApplied(
  applied: readonly string[],
  restoreId: string,
): string[] {
  if (applied.includes(restoreId)) return applied as string[];
  return [...applied, restoreId];
}

/** Drop the ledger entry once the server confirms the row is gone. */
export function forgetRestoreApplied(
  applied: readonly string[],
  restoreId: string,
): string[] {
  if (!applied.includes(restoreId)) return applied as string[];
  return applied.filter((id) => id !== restoreId);
}

// ---------------------------------------------------------------------------
// Server-less queue (per session, FIFO)
// ---------------------------------------------------------------------------

export function enqueuePendingRestore(
  queue: Readonly<Record<string, PendingSendRestore[]>>,
  restore: PendingSendRestore,
): Record<string, PendingSendRestore[]> {
  if (!restore.sessionId || !restore.id) return queue as Record<string, PendingSendRestore[]>;
  const existing = queue[restore.sessionId] ?? [];
  if (existing.some((r) => r.id === restore.id)) {
    return queue as Record<string, PendingSendRestore[]>;
  }
  return { ...queue, [restore.sessionId]: [...existing, restore] };
}

export function dequeuePendingRestore(
  queue: Readonly<Record<string, PendingSendRestore[]>>,
  sessionId: string,
  restoreId: string,
): Record<string, PendingSendRestore[]> {
  const existing = queue[sessionId];
  if (!existing?.some((r) => r.id === restoreId)) {
    return queue as Record<string, PendingSendRestore[]>;
  }
  const remaining = existing.filter((r) => r.id !== restoreId);
  const next = { ...queue };
  if (remaining.length > 0) next[sessionId] = remaining;
  else delete next[sessionId];
  return next;
}

// ---------------------------------------------------------------------------
// Cancel-response handling
// ---------------------------------------------------------------------------

/** The `cancelled_chat_message` payload as it arrives on the wire. */
export interface CancelledChatMessage {
  chat_session_id: string;
  message_id: string;
  content: string;
  restore_to_input: boolean;
  attachments?: Attachment[];
}

/**
 * What a completed cancel means for the local caches and the composer.
 *
 * The bubble removal is unconditional-on-presence: the server really did delete
 * that message, so leaving it rendered would show a prompt that no longer
 * exists. The composer restore is the narrow part, and every guard is
 * load-bearing (they are web's, verbatim):
 *
 *   - `restore_to_input` — the server only sets it when the deleted row was the
 *     member's typed prompt rather than a kickoff the turn had adopted.
 *   - `!queuedAction` — a queued *remove* is an explicit discard; putting the
 *     text back would undo the user's own instruction.
 *   - `restoreDraftToInput` — the caller's own intent flag (the list-row stop
 *     cancels without a composer to restore into).
 *   - session match — the restore belongs to the session that was cancelled,
 *     which may not be the one on screen.
 */
export function planCancelRestore(
  cancelled: CancelledChatMessage | null | undefined,
  args: {
    sessionId: string;
    queuedAction?: "edit" | "remove";
    restoreDraftToInput: boolean;
  },
): { removeMessageId: string | null; restore: PendingSendRestore | null } {
  if (!cancelled) return { removeMessageId: null, restore: null };
  const removeMessageId = cancelled.message_id;
  const restore =
    cancelled.restore_to_input &&
    !args.queuedAction &&
    args.restoreDraftToInput &&
    cancelled.chat_session_id === args.sessionId
      ? {
          id: cancelled.message_id,
          content: cancelled.content,
          attachments: cancelled.attachments,
          sessionId: cancelled.chat_session_id,
        }
      : null;
  return { removeMessageId, restore };
}

// ---------------------------------------------------------------------------
// chat:cancel_finalized
// ---------------------------------------------------------------------------

/**
 * A `chat:cancel_finalized` payload's effect on local state. The event is the
 * deferred counterpart of the cancel HTTP response: nothing else refetches when
 * it arrives, so the message caches have to be nudged here.
 *
 * `restored` carries no content by design — the deleted prompt is durable
 * server-side and readable only by its creator — so it is a pure invalidation
 * hint plus a cache eviction. The draft-restores refetch is gated to the task's
 * initiator and fails closed on a missing id: getting it wrong only means a
 * client fetches a restore it may not apply, never that a prompt is lost.
 */
export function planCancelFinalized(args: {
  outcome: "stopped" | "restored";
  chatSessionId: string;
  taskId: string;
  messageId?: string;
  initiatorUserId?: string;
  currentUserId?: string;
}): {
  removeMessageId: string | null;
  cancelTaskId: string | null;
  refetchDraftRestores: boolean;
} {
  if (args.outcome === "stopped") {
    // A late "Stopped." assistant row landed; nothing to evict or refetch.
    return { removeMessageId: null, cancelTaskId: null, refetchDraftRestores: false };
  }
  return {
    removeMessageId: args.messageId ?? null,
    cancelTaskId: args.taskId,
    refetchDraftRestores:
      !!args.initiatorUserId &&
      !!args.currentUserId &&
      args.initiatorUserId === args.currentUserId,
  };
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

/**
 * Turn a restored server attachment row into a staged composer chip.
 *
 * The row is already uploaded, so the chip goes straight to `completed` — the
 * composer submits by `id` and must not re-upload. `localUri` points at the
 * server copy because there is no on-device file: the attachment was detached
 * from a message this device may never have had bytes for (a restore can arrive
 * on a second device, or after a reinstall). The image lightbox accepts a
 * remote uri, and non-image chips open `downloadUrl` through the authenticated
 * downloader.
 */
export function restoredAttachmentToComposerItem(
  attachment: Attachment,
  resolveUrl: (raw: string | null | undefined) => string | null,
): {
  localId: string;
  localUri: string;
  filename: string;
  mimeType: string;
  status: "completed";
  id: string;
  url: string;
  downloadUrl?: string;
} {
  const remote = resolveUrl(attachment.url) ?? "";
  const download = resolveUrl(attachment.download_url);
  return {
    // The server row id is stable and unique per restore, so it doubles as the
    // React key / lookup id — unlike a picked file, nothing is in flight.
    localId: `restore:${attachment.id}`,
    localUri: remote,
    filename: attachment.filename,
    mimeType: attachment.content_type || "application/octet-stream",
    status: "completed",
    id: attachment.id,
    url: remote,
    ...(download ? { downloadUrl: download } : {}),
  };
}
