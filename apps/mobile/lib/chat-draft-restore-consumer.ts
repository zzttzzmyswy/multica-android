/**
 * The cancelled-prompt restore *transitions* — the terminal half of the state
 * machine, extracted from the React hook so the Node vitest lane can test it.
 *
 * `lib/use-chat-draft-restore.ts` owns the React-shaped parts (query, effects,
 * "what may be offered now"). This module owns what happens when a hand-off
 * becomes terminal, and it is where the loss-prevention guarantees actually
 * live:
 *
 *   - An OFFER is never terminal. Recording the ledger entry and deleting the
 *     server row only ever happens after the composer reports it wrote the text
 *     — consuming on offer would delete the prompt's only copy for a hand-off
 *     the composer then declined (its draft was not empty).
 *   - The ledger is written BEFORE the DELETE goes out, and survives a failed
 *     DELETE. A consume that never lands (offline, app killed, retries spent)
 *     must not make the prompt reappear after the user has sent it.
 *   - The row is removed from the cached list on a CONFIRMED delete only, so a
 *     failed consume is retried by the next fetch rather than assumed done.
 *
 * No React and no native imports: every collaborator is injected.
 */
import type { ChatDraftRestoresResponse } from "@multica/core/types";
import type { PendingSendRestore, RestoreDraftRequest } from "@/lib/chat-draft-restore";

/** The cache surface this module touches. Narrowed to what it needs so the
 *  test lane can pass a stub instead of a real QueryClient. */
export interface RestoreCache {
  /** Drop `restoreId` from the session's cached draft-restores list. */
  dropRestore(sessionId: string, restoreId: string): void;
}

export interface RestoreConsumerDeps {
  /** DELETE the durable row. Idempotent server-side (204 for a row that is
   *  already gone), which is what makes retrying safe. */
  consumeRemote(sessionId: string, restoreId: string): Promise<void>;
  /** Record the hand-off in the persisted ledger. */
  markApplied(restoreId: string): void;
  /** Drop the ledger entry — only on a confirmed delete. */
  forgetApplied(restoreId: string): void;
  /** Queue a server-less restore for its session. */
  enqueueLocal(restore: PendingSendRestore): void;
  /** Drop a server-less restore once its text is in the persisted draft. */
  dequeueLocal(sessionId: string, restoreId: string): void;
  cache: RestoreCache;
  /** Diagnostics only — nothing branches on it. */
  onError?: (restoreId: string, err: unknown) => void;
}

export interface RestoreConsumer {
  /** Fire the idempotent DELETE, and release the ledger entry when the server
   *  confirms the row is gone. Safe to call repeatedly for the same id: an
   *  in-flight or already-finished consume is not re-sent. */
  consume(sessionId: string, restoreId: string): void;
  /**
   * The composer wrote the draft — the only terminal transition.
   *
   * Durable: ledger first, then consume. Server-less: drop the queue entry,
   * because the text now lives in the (persisted) draft.
   */
  applyTerminal(request: RestoreDraftRequest): void;
}

export function createRestoreConsumer(deps: RestoreConsumerDeps): RestoreConsumer {
  // In-flight/recent consumes, so a re-render or a second fetch does not fire a
  // duplicate request for the same row. Released on settle — including failure,
  // which is what lets the next fetch reconcile a consume whose retries ran out.
  const inFlight = new Set<string>();

  const consume = (sessionId: string, restoreId: string) => {
    if (inFlight.has(restoreId)) return;
    inFlight.add(restoreId);
    void deps
      .consumeRemote(sessionId, restoreId)
      .then(() => {
        // Confirmed gone: the ledger entry has nothing left to protect against,
        // and the cached list should stop offering it.
        deps.forgetApplied(restoreId);
        deps.cache.dropRestore(sessionId, restoreId);
      })
      .catch((err: unknown) => {
        // Deliberately keeps the ledger entry. The draft is safe (it is in the
        // composer) and the ledger is what stops the prompt being offered a
        // second time; dropping it here would re-arm a prompt the user has
        // already sent. The next fetch re-runs this.
        deps.onError?.(restoreId, err);
      })
      .finally(() => {
        inFlight.delete(restoreId);
      });
  };

  const applyTerminal = (request: RestoreDraftRequest) => {
    const { id, serverRestoreId, sessionId } = request;
    if (serverRestoreId && sessionId) {
      deps.markApplied(serverRestoreId);
      consume(sessionId, serverRestoreId);
      return;
    }
    if (sessionId) deps.dequeueLocal(sessionId, id);
  };

  return { consume, applyTerminal };
}

/** Remove a restore row from a cached draft-restores response. Pure, so the
 *  hook's cache write is the same expression the dry-run tests exercise. */
export function dropRestoreFromResponse(
  old: ChatDraftRestoresResponse | undefined,
  restoreId: string,
): ChatDraftRestoresResponse | undefined {
  if (!old) return old;
  return { ...old, restores: old.restores.filter((r) => r.id !== restoreId) };
}
