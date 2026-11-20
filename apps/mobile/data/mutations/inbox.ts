/**
 * Mobile inbox mutations. Mirrors the optimistic-update + invalidate pattern
 * of packages/core/inbox/mutations.ts — written here in mobile-owned code
 * per Sharing Principles (no runtime imports from @multica/core mutations).
 *
 * Behavioral parity:
 *   - mark-read: flip `read` to true locally; rollback on error; settle invalidate.
 *     `onMutate` writes setQueryData BEFORE awaiting cancelQueries — this is
 *     load-bearing for iOS Stack push transitions: when the user taps an
 *     inbox row and we router.push to issue/[id], iOS captures a snapshot of
 *     the source view for the slide animation; if the read-state flip hadn't
 *     landed in cache by that snapshot, the row appears unread frozen in
 *     the animation. Synchronous setQueryData ensures the next paint already
 *     has the flipped state. (Previously the caller did this hack at tap
 *     site; moved into the mutation so every caller benefits.)
 *   - archive single: flip `archived` to true on the item AND on every other
 *     inbox row that shares the same `issue_id` (web does the same — see
 *     packages/core/inbox/mutations.ts:37-46). Visually the row disappears
 *     because `deduplicateInboxItems` (apps/mobile/lib/inbox-display.ts)
 *     filters archived items out before render.
 *   - mark-all-read: flip `read` to true on every non-archived row (matches
 *     web; the server-side query does the same predicate).
 *   - archive batch (all / all-read / completed): no optimistic patch — the
 *     row predicates depend on server-side state (e.g. issue.status="done"
 *     isn't carried on every row, and mobile shouldn't re-derive the filter).
 *     Just invalidate on settle. Matches web.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { InboxItem } from "@multica/core/types";
import { api } from "@/data/api";
import { inboxKeys } from "@/data/queries/inbox";
import { invalidateInboxSummary } from "@/data/realtime/inbox-ws-updaters";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  acquireInboxWrite,
  patchInboxFields,
  resolveInboxIssue,
  rollbackInboxFields,
} from "./inbox-optimistic";
import {
  WRITE_FAILURE_TITLE_KEY,
  WRITE_FAILURE_CONFLICT_KEY,
  WRITE_FAILURE_CONFLICT_CODE_KEY,
} from "@/lib/write-failure";

const pendingFeedback = {
  [WRITE_FAILURE_CONFLICT_KEY]: "inbox.actionPending",
  [WRITE_FAILURE_CONFLICT_CODE_KEY]: "inbox_action_pending",
};

export function useMarkInboxRead() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    meta: { ...pendingFeedback, [WRITE_FAILURE_TITLE_KEY]: "inbox.markReadFailed" },
    mutationFn: (id: string) => api.markInboxRead(id),
    onMutate: async (id) => {
      const key = inboxKeys.list(wsId);
      const release = acquireInboxWrite(qc, wsId, [`read:${id}`]);
      // Capture before the synchronous navigation-critical read flip.
      const undo = patchInboxFields(qc, [key], "read", true, (item) => item.id === id);
      try {
        await qc.cancelQueries({ queryKey: key }, { revert: false });
        return { undo, release };
      } catch (error) {
        rollbackInboxFields(qc, undo);
        release();
        throw error;
      }
    },
    onError: (_err, _id, ctx) => rollbackInboxFields(qc, ctx?.undo),
    onSettled: async (_data, _error, _variables, ctx) => {
      if (!ctx) return;
      try {
        // A failed refresh must not turn a successful write into a rollback.
        await qc.invalidateQueries({ queryKey: inboxKeys.list(wsId) }).catch(() => undefined);
      } finally {
        ctx.release();
      }
    },
  });
}

/**
 * Flip a notification back to unread — the inverse of useMarkInboxRead.
 *
 * Mirrors web's useMarkInboxUnread (packages/core/inbox/mutations.ts): same
 * optimistic shape as marking read (predictable outcome, no navigation, trivial
 * rollback). The unread tab badge derives from the main list's cache
 * (lib/unread-counts.ts), so the optimistic patch raises the badge without
 * waiting for the round-trip; onSettled invalidates for convergence.
 */
export function useMarkInboxUnread() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    meta: { ...pendingFeedback, [WRITE_FAILURE_TITLE_KEY]: "inbox.markUnreadFailed" },
    mutationFn: (id: string) => api.markInboxUnread(id),
    onMutate: async (id) => {
      const key = inboxKeys.list(wsId);
      const release = acquireInboxWrite(qc, wsId, [`read:${id}`]);
      const undo = patchInboxFields(qc, [key], "read", false, (item) => item.id === id);
      try {
        await qc.cancelQueries({ queryKey: key }, { revert: false });
        return { undo, release };
      } catch (error) {
        rollbackInboxFields(qc, undo);
        release();
        throw error;
      }
    },
    onError: (_err, _id, ctx) => rollbackInboxFields(qc, ctx?.undo),
    onSettled: async (_data, _error, _variables, ctx) => {
      if (!ctx) return;
      try {
        // A failed refresh must not turn a successful write into a rollback.
        await qc.invalidateQueries({ queryKey: inboxKeys.list(wsId) }).catch(() => undefined);
        // The switcher dot must light again when this workspace goes back to
        // having unread items — that count lives on the server. Mirrors web's
        // useMarkInboxUnread (packages/core/inbox/mutations.ts:71).
        invalidateInboxSummary(qc);
      } finally {
        ctx.release();
      }
    },
  });
}

export function useArchiveInbox() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    meta: { ...pendingFeedback, [WRITE_FAILURE_TITLE_KEY]: "inbox.archiveFailed" },
    mutationFn: (id: string) => api.archiveInbox(id),
    onMutate: async (id) => {
      // Resolve once across all pages BEFORE patching any page: siblings can
      // live on a page that does not contain the tapped notification.
      const issueId = resolveInboxIssue(qc, wsId, id);
      const release = acquireInboxWrite(qc, wsId, [`archived:${issueId ? `issue:${issueId}` : `item:${id}`}`]);
      try {
        await qc.cancelQueries({ queryKey: inboxKeys.list(wsId) });
        const keys = [inboxKeys.list(wsId)];
        const undo = patchInboxFields(qc, keys, "archived", true,
          (item) => item.id === id || (!!issueId && item.issue_id === issueId));
        // Opposite bucket is invalidated, never optimistically inserted into.
        return { undo, release };
      } catch (error) {
        release();
        throw error;
      }
    },
    onError: (_err, _id, ctx) => rollbackInboxFields(qc, ctx?.undo),
    onSettled: async (_data, _error, _variables, ctx) => {
      if (!ctx) return;
      try {
        // Both lists: the item just moved from the main inbox into the archive,
        // and a sibling of the same issue could resurface in the archived view
        // after the refetch (web invalidates all inbox keys too). The prefix
        // reaches the paged archive and its facets, so the counts follow the
        // rows rather than lagging a reload behind.
        await qc.invalidateQueries({ queryKey: inboxKeys.all(wsId) }).catch(() => undefined);
      } finally {
        ctx.release();
      }
    },
  });
}

/**
 * Pure optimistic patch for archiving: flip `archived:true` on the row AND on
 * every sibling that shares the same issue_id — the single archive endpoint
 * archives the whole issue group server-side, and patching only the tapped row
 * would let the dedup'd siblings briefly resurface between the request and the
 * WS invalidate. Exported for the pure-function tests (mutations/inbox-patches).
 */
export function archiveInboxPatch(
  prev: InboxItem[] | undefined,
  id: string,
): InboxItem[] | undefined {
  if (!prev) return undefined;
  const target = prev.find((i) => i.id === id);
  const issueId = target?.issue_id ?? null;
  return prev.map((item) =>
    item.id === id || (issueId && item.issue_id === issueId)
      ? { ...item, archived: true }
      : item,
  );
}

/**
 * Restore an archived notification to the main inbox.
 *
 * Mirrors web's useUnarchiveInbox (packages/core/inbox/mutations.ts): the
 * optimistic patch targets the ARCHIVED cache only — flipping `archived:false`
 * drops the row out of the archived view at once (the dedup helper filters on
 * it), the user stays put, and rollback restores only this write's changed
 * archived flags. The main list is left to onSettled: its contents after a
 * restore are the server's call (which sibling rows come back, their read
 * state, their order), so it is invalidated instead of reconstructed
 * client-side. The server preserves the row's read state verbatim.
 */
export function useUnarchiveInbox() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    meta: { ...pendingFeedback, [WRITE_FAILURE_TITLE_KEY]: "inbox.unarchiveFailed" },
    mutationFn: (id: string) => api.unarchiveInbox(id),
    onMutate: async (id) => {
      // Resolve once across all pages BEFORE patching any page: siblings can
      // live on a page that does not contain the tapped notification.
      const issueId = resolveInboxIssue(qc, wsId, id);
      const release = acquireInboxWrite(qc, wsId, [`archived:${issueId ? `issue:${issueId}` : `item:${id}`}`]);
      try {
        await qc.cancelQueries({ queryKey: inboxKeys.archived(wsId) });
        const keys = qc.getQueriesData({ queryKey: inboxKeys.archived(wsId) }).map(([key]) => key);
        const undo = patchInboxFields(qc, keys, "archived", false,
          (item) => item.id === id || (!!issueId && item.issue_id === issueId));
        // Opposite bucket is invalidated, never optimistically inserted into.
        return { undo, release };
      } catch (error) {
        release();
        throw error;
      }
    },
    onError: (_err, _id, ctx) => rollbackInboxFields(qc, ctx?.undo),
    onSettled: async (_data, _error, _variables, ctx) => {
      if (!ctx) return;
      try {
        // Both lists: the item just moved from the archive back into the main
        // inbox, and the unread tab badge rises again when it was archived
        // unread (that badge derives from the main list cache).
        await qc.invalidateQueries({ queryKey: inboxKeys.all(wsId) }).catch(() => undefined);
        // …and so does the cross-workspace switcher dot, which is a server-side
        // count. Mirrors web's useUnarchiveInbox
        // (packages/core/inbox/mutations.ts:145).
        invalidateInboxSummary(qc);
      } finally {
        ctx.release();
      }
    },
  });
}

/**
 * Pure optimistic patch for unarchiving: flip `archived:false` on the row AND
 * on every sibling sharing the same issue_id — the single unarchive endpoint
 * restores the whole issue group server-side, and patching only the tapped row
 * would let the dedup'd siblings linger in the archived view until the
 * refetch. Exported for the pure-function tests (mutations/inbox-patches).
 */
export function unarchiveInboxPatch(
  prev: InboxItem[] | undefined,
  id: string,
): InboxItem[] | undefined {
  if (!prev) return undefined;
  const target = prev.find((i) => i.id === id);
  const issueId = target?.issue_id ?? null;
  return prev.map((item) =>
    item.id === id || (issueId && item.issue_id === issueId)
      ? { ...item, archived: false }
      : item,
  );
}

/**
 * Pure optimistic patch for mark-unread: flip `read:false` on the single row.
 * A row never lives in both caches (the server's main/archived queries are
 * mutually exclusive by issue), so no sibling or cross-list patching is needed.
 * Exported for the pure-function tests (mutations/inbox-patches).
 */
export function markInboxUnreadPatch(
  prev: InboxItem[] | undefined,
  id: string,
): InboxItem[] | undefined {
  if (!prev) return undefined;
  return prev.map((item) => (item.id === id ? { ...item, read: false } : item));
}

export function useMarkAllInboxRead() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    meta: { ...pendingFeedback, [WRITE_FAILURE_TITLE_KEY]: "inbox.markReadFailed" },
    mutationFn: () => api.markAllInboxRead(),
    onMutate: async () => {
      const key = inboxKeys.list(wsId);
      const ids = new Set((qc.getQueryData<InboxItem[]>(key) ?? []).filter((item) => !item.archived).map((item) => item.id));
      const release = acquireInboxWrite(qc, wsId, [...ids].map((id) => `read:${id}`));
      try {
        await qc.cancelQueries({ queryKey: key });
        const undo = patchInboxFields(qc, [key], "read", true, (item) => ids.has(item.id) && !item.archived);
        return { undo, release };
      } catch (error) {
        release();
        throw error;
      }
    },
    onError: (_err, _vars, ctx) => rollbackInboxFields(qc, ctx?.undo),
    onSettled: async (_data, _error, _variables, ctx) => {
      if (!ctx) return;
      try {
        // A failed refresh must not turn a successful write into a rollback.
        await qc.invalidateQueries({ queryKey: inboxKeys.list(wsId) }).catch(() => undefined);
      } finally {
        ctx.release();
      }
    },
  });
}

// Batch archive mutations — invalidate-only, matching web. The optimistic
// path isn't worth the complexity: archive-completed depends on the issue
// status of each linked issue (not carried on InboxItem), and predicting
// that on the client risks divergence with the server's SQL filter.
export function useArchiveAllInbox() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  return useMutation({
    meta: { [WRITE_FAILURE_TITLE_KEY]: "inbox.batchFailed" },
    mutationFn: () => api.archiveAllInbox(),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: inboxKeys.list(wsId) });
    },
  });
}

export function useArchiveAllReadInbox() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  return useMutation({
    meta: { [WRITE_FAILURE_TITLE_KEY]: "inbox.batchFailed" },
    mutationFn: () => api.archiveAllReadInbox(),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: inboxKeys.list(wsId) });
    },
  });
}

export function useArchiveCompletedInbox() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  return useMutation({
    meta: { [WRITE_FAILURE_TITLE_KEY]: "inbox.batchFailed" },
    mutationFn: () => api.archiveCompletedInbox(),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: inboxKeys.list(wsId) });
    },
  });
}
