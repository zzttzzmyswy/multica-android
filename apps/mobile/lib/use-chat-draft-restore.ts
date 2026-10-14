/**
 * Owns the durable draft-restore lifecycle for the chat composer (#5219).
 *
 * Mirrors web's `useChatDraftRestore` (packages/views/chat/components/
 * use-chat-draft-restore.ts). Mobile mounts exactly one chat composer at a time
 * (the chat tab; the agent-builder surface is a separate, server-less flow), so
 * the "two visible composers may both adopt it" case web reasons about cannot
 * arise here — but the ordering rules below are kept verbatim anyway, because
 * they are what makes the hand-off lossless rather than merely usually-correct.
 *
 * Two kinds of restore feed one composer, with different failure modes:
 *
 *   - Durable (a deferred-cancellation row): the server holds the text, so an
 *     offer that is never taken can simply be dropped and refetched. Applying it
 *     records the id in a *persisted* ledger BEFORE the consume goes out, so a
 *     lost consume cannot re-offer a prompt the user has already sent. Any row
 *     that outlives its ledger entry is re-consumed on every fetch until the
 *     server confirms it is gone.
 *   - Server-less (a synchronous cancel response): the server already deleted
 *     the message and there is no second copy, so it goes into the persisted
 *     per-session queue and stays there until the composer reports it applied.
 *
 * The hand-off itself is at-most-once and lossless:
 *
 *   - A restore is OFFERED; the composer either applies it (its draft is empty)
 *     or leaves it alone (the user has work in progress). A skipped restore
 *     stays pending and is re-offered the moment the draft clears — it is never
 *     marked done and never consumed.
 *   - Only an applied restore is terminal.
 *
 * `enabled` is what decides whether this composer may claim anything at all. A
 * backgrounded surface must not apply (and therefore consume) a prompt the user
 * is waiting for in a foreground one — that is a silent theft, not a duplicate
 * draft. Mobile gates on both tab focus and app foreground, mirroring web's
 * `isActive && appForeground`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Attachment, ChatDraftRestoresResponse } from "@multica/core/types";
import { chatDraftRestoresOptions, chatKeys } from "@/data/queries/chat";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useChatDraftRestoreStore } from "@/data/stores/chat-draft-restore-store";
import {
  decideRestoreApplication,
  pickPendingRestore,
  pickRestoresToReconcile,
  type RestoreDraftRequest,
} from "@/lib/chat-draft-restore";
import {
  createRestoreConsumer,
  dropRestoreFromResponse,
} from "@/lib/chat-draft-restore-consumer";
import { api } from "@/data/api";

/** Stable fallbacks for the ledger selectors — see the hoisting note where they
 *  are used. A fresh literal per selector call is an infinite render loop. */
const EMPTY_APPLIED_RESTORES: readonly string[] = [];
const EMPTY_RESTORE_QUEUE: Record<string, never> = {};

/** Tracks whether the app is in the foreground, so a backgrounded composer
 *  never claims a restore. Mirrors web's `useAppForeground`. */
function useAppForeground(): boolean {
  const [foreground, setForeground] = useState(
    () => AppState.currentState === "active",
  );
  useEffect(() => {
    const sub = AppState.addEventListener("change", (status: AppStateStatus) => {
      setForeground(status === "active");
    });
    return () => sub.remove();
  }, []);
  return foreground;
}

export function useChatDraftRestore(
  activeSessionId: string | null,
  /** Extra gate from the caller (e.g. the chat tab is the visible surface). */
  enabled = true,
) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const isFocused = useIsFocused();
  const appForeground = useAppForeground();
  const canClaim = enabled && isFocused && appForeground;

  const [restoreDraftRequest, setRestoreDraftRequest] =
    useState<RestoreDraftRequest | null>(null);

  // Hoisted empties. A selector returning a fresh `[]` / `{}` literal fails
  // Zustand's `Object.is` comparison on EVERY store notification, so the
  // component re-renders on every notification forever — which on device is a
  // hard crash ("Maximum update depth exceeded"), not just wasted renders. The
  // same identity has to come back while the workspace has no entry yet.
  const appliedRestoreIds = useChatDraftRestoreStore((s) =>
    wsId ? (s.appliedByWorkspace[wsId] ?? EMPTY_APPLIED_RESTORES) : EMPTY_APPLIED_RESTORES,
  );
  const pendingSendRestores = useChatDraftRestoreStore((s) =>
    wsId ? (s.queueByWorkspace[wsId] ?? EMPTY_RESTORE_QUEUE) : EMPTY_RESTORE_QUEUE,
  );
  const hydrate = useChatDraftRestoreStore((s) => s.hydrate);
  const markApplied = useChatDraftRestoreStore((s) => s.markApplied);
  const forgetApplied = useChatDraftRestoreStore((s) => s.forgetApplied);
  const enqueuePending = useChatDraftRestoreStore((s) => s.enqueue);
  const dequeuePending = useChatDraftRestoreStore((s) => s.dequeue);

  useEffect(() => {
    if (wsId) void hydrate(wsId);
  }, [wsId, hydrate]);

  // The durable rows. `enabled` gates the FETCH as well as the claim: a disabled
  // composer should not even look, so a hidden surface can never race the
  // visible one to the consume.
  const { data: draftRestoresData } = useQuery({
    ...chatDraftRestoresOptions(activeSessionId),
    enabled: canClaim && !!activeSessionId,
  });
  const restores = draftRestoresData?.restores;

  // In-flight consumes, so a re-render or a second fetch doesn't fire a
  // duplicate request for the same row. The terminal transitions themselves
  // live in `createRestoreConsumer`, which the Node lane tests directly — they
  // are where the loss-prevention guarantees are, so they must not be reachable
  // only through a React renderer this repo's test lane does not have.
  const consumer = useMemo(
    () =>
      createRestoreConsumer({
        consumeRemote: (sessionId, restoreId) =>
          api.consumeChatDraftRestore(sessionId, restoreId),
        markApplied: (restoreId) => {
          if (wsId) markApplied(wsId, restoreId);
        },
        forgetApplied: (restoreId) => {
          if (wsId) forgetApplied(wsId, restoreId);
        },
        enqueueLocal: (restore) => {
          if (wsId) enqueuePending(wsId, restore);
        },
        dequeueLocal: (sessionId, restoreId) => {
          if (wsId) dequeuePending(wsId, sessionId, restoreId);
        },
        cache: {
          dropRestore: (sessionId, restoreId) => {
            qc.setQueryData(
              chatKeys.draftRestores(sessionId),
              (old: ChatDraftRestoresResponse | undefined) =>
                dropRestoreFromResponse(old, restoreId),
            );
          },
        },
      }),
    [wsId, markApplied, forgetApplied, enqueuePending, dequeuePending, qc],
  );

  const { consume } = consumer;

  // Reconcile rows whose consume never landed. Firing this from the fetched list
  // (rather than only at apply time) is what closes the lost-consume hole: the
  // row is re-consumed on the next mount, refetch or reconnect until it is gone.
  // The consumer de-dupes in-flight ids, so this cannot storm.
  useEffect(() => {
    if (!canClaim || !activeSessionId || !restores) return;
    for (const row of pickRestoresToReconcile(
      restores,
      activeSessionId,
      appliedRestoreIds,
    )) {
      consume(activeSessionId, row.id);
    }
  }, [
    restores,
    activeSessionId,
    appliedRestoreIds,
    consume,
    canClaim,
  ]);

  // Offer the next restore to the composer. Server-less first: both kinds are
  // re-offered until applied, but that one is the user's own text with no copy
  // anywhere else, so it should get in front of them soonest.
  useEffect(() => {
    if (!canClaim || !activeSessionId || !wsId) {
      // The composer went away (tab switched, app backgrounded). Release the
      // slot rather than hold an offer nobody can see: a durable request is
      // refetched, a server-less one is still in its persisted queue. Nothing
      // was applied, so nothing is lost, and the surface the user IS looking at
      // gets to claim it.
      if (restoreDraftRequest) setRestoreDraftRequest(null);
      return;
    }
    if (restoreDraftRequest) {
      // One rule for the single slot: it only ever holds a request for the
      // session on screen. A request aimed at a session the user may never
      // return to would otherwise starve every hand-off for the one they ARE
      // looking at.
      const { sessionId } = restoreDraftRequest;
      if (!sessionId || sessionId === activeSessionId) return;
      setRestoreDraftRequest(null);
      return;
    }
    const queued = pendingSendRestores[activeSessionId]?.[0];
    if (queued) {
      setRestoreDraftRequest({
        id: queued.id,
        content: queued.content,
        attachments: queued.attachments,
        sessionId: activeSessionId,
      });
      return;
    }
    const row = pickPendingRestore(
      restores,
      activeSessionId,
      appliedRestoreIds,
    );
    if (!row) return;
    setRestoreDraftRequest({
      id: row.id,
      content: row.content ?? "",
      attachments: row.attachments as Attachment[] | undefined,
      sessionId: row.chat_session_id,
      serverRestoreId: row.id,
    });
  }, [
    restores,
    activeSessionId,
    restoreDraftRequest,
    appliedRestoreIds,
    pendingSendRestores,
    canClaim,
    wsId,
  ]);

  /**
   * A restore with no server copy — a cancel that answered synchronously with
   * `restore_to_input`. Its text exists nowhere else, so it goes into the
   * persisted per-session queue; the effect above hands it to the composer.
   */
  const enqueueLocalRestore = useCallback(
    (restore: {
      id: string;
      content: string;
      attachments?: Attachment[];
      sessionId: string;
    }) => {
      if (!wsId) return;
      enqueuePending(wsId, restore);
    },
    [enqueuePending, wsId],
  );

  /**
   * Settle a durable restore whose content the caller already applied from the
   * cancel RESPONSE.
   *
   * The queued-only (`queue_action=edit`) branch is the one place the server
   * both creates a durable row and hands the same content back synchronously —
   * `settleQueuedChatInput` writes the row keyed on the deleted message id and
   * returns that content in the same transaction. Web takes only the row and
   * waits a round trip to show the prompt; mobile shows it immediately from the
   * response and settles the row here, which leaves the same end state (draft
   * holds the prompt, row consumed, ledger clean) without the delay.
   *
   * The DELETE is idempotent and 204s for a row that never existed, so this is
   * safe even if the server predates the durable endpoint.
   */
  const settleDurableRestore = useCallback(
    (sessionId: string, restoreId: string) => {
      if (!wsId) return;
      consumer.applyTerminal({ id: restoreId, content: "", sessionId, serverRestoreId: restoreId });
    },
    [consumer, wsId],
  );

  /**
   * The composer wrote the draft. This is the only terminal transition — see
   * `createRestoreConsumer` for the ordering it guarantees.
   */
  const handleRestoreDraftApplied = useCallback(() => {
    if (!restoreDraftRequest) return;
    consumer.applyTerminal(restoreDraftRequest);
    setRestoreDraftRequest(null);
  }, [restoreDraftRequest, consumer]);

  // Whether the owner will hand this request over at all. The composer applies
  // it only if it is not mid-draft — see `RestoreApplication`.
  const application = decideRestoreApplication({
    request: restoreDraftRequest,
    draftKey: activeSessionId ?? "",
    appliedRestoreIds,
  });

  /** The composer calls this once it has actually written the draft. */
  const confirmRestoreApplied = useCallback(() => {
    if (!restoreDraftRequest) return;
    handleRestoreDraftApplied();
  }, [restoreDraftRequest, handleRestoreDraftApplied]);

  return {
    restoreDraftRequest,
    /** `"apply"` ⇒ the composer should write `restoreDraftRequest` now. */
    application,
    confirmRestoreApplied,
    enqueueLocalRestore,
    settleDurableRestore,
  };
}
