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
import { useWorkspaceStore } from "@/data/workspace-store";

export function useMarkInboxRead() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (id: string) => api.markInboxRead(id),
    onMutate: async (id) => {
      const key = inboxKeys.list(wsId);
      // Synchronous patch FIRST — see the file-level doc comment for why.
      qc.setQueryData<InboxItem[]>(key, (old) =>
        old?.map((item) => (item.id === id ? { ...item, read: true } : item)),
      );
      // Then the standard cancel + snapshot dance for rollback.
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<InboxItem[]>(key);
      return { prev, key };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: inboxKeys.list(wsId) });
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
    mutationFn: (id: string) => api.markInboxUnread(id),
    onMutate: async (id) => {
      const key = inboxKeys.list(wsId);
      // Synchronous patch FIRST — same load-bearing ordering as mark-read
      // (see the file-level doc comment): the flipped read state must be
      // visible to the very next paint of the row.
      qc.setQueryData<InboxItem[]>(key, (old) =>
        markInboxUnreadPatch(old, id),
      );
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<InboxItem[]>(key);
      return { prev, key };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: inboxKeys.list(wsId) });
    },
  });
}

export function useArchiveInbox() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (id: string) => api.archiveInbox(id),
    onMutate: async (id) => {
      const key = inboxKeys.list(wsId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<InboxItem[]>(key);
      // Match web: archive every row that shares the same issue_id — the
      // single archive endpoint archives all sibling rows server-side too
      // (`server/internal/queries/inbox.sql` UPDATE … WHERE issue_id = ?).
      // Patching only the tapped row would let dedup'd siblings briefly
      // resurface between the request and the WS invalidate.
      const target = prev?.find((i) => i.id === id);
      const issueId = target?.issue_id ?? null;
      qc.setQueryData<InboxItem[]>(key, (old) =>
        old?.map((item) =>
          item.id === id || (issueId && item.issue_id === issueId)
            ? { ...item, archived: true }
            : item,
        ),
      );
      return { prev, key };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: inboxKeys.list(wsId) });
    },
  });
}

/**
 * Restore an archived notification to the main inbox.
 *
 * Mirrors web's useUnarchiveInbox (packages/core/inbox/mutations.ts): the
 * optimistic patch targets the ARCHIVED cache only — flipping `archived:false`
 * drops the row out of the archived view at once (the dedup helper filters on
 * it), the user stays put on the archive view, and rollback is a single
 * snapshot restore. The main list is left to onSettled: its contents after a
 * restore are the server's call (which sibling rows come back, their read
 * state, their order), so it is invalidated instead of reconstructed
 * client-side. The server preserves the row's read state verbatim.
 */
export function useUnarchiveInbox() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (id: string) => api.unarchiveInbox(id),
    onMutate: async (id) => {
      const key = inboxKeys.archived(wsId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<InboxItem[]>(key);
      qc.setQueryData<InboxItem[]>(key, (old) => unarchiveInboxPatch(old, id));
      return { prev, key };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: () => {
      // Both lists: the item just moved from the archive back into the main
      // inbox, and the unread tab badge rises again when it was archived
      // unread (that badge derives from the main list cache).
      qc.invalidateQueries({ queryKey: inboxKeys.all(wsId) });
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
    mutationFn: () => api.markAllInboxRead(),
    onMutate: async () => {
      const key = inboxKeys.list(wsId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<InboxItem[]>(key);
      qc.setQueryData<InboxItem[]>(key, (old) =>
        old?.map((item) =>
          !item.archived ? { ...item, read: true } : item,
        ),
      );
      return { prev, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: inboxKeys.list(wsId) });
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
    mutationFn: () => api.archiveCompletedInbox(),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: inboxKeys.list(wsId) });
    },
  });
}
