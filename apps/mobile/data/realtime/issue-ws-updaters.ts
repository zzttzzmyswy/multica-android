/**
 * Mobile-owned WS cache patchers for the issue domain. These are pure
 * functions over `QueryClient` — no React, no WS plumbing. The hooks in
 * `use-issue-realtime.ts` and `use-my-issues-realtime.ts` translate WS
 * events into calls into this module.
 *
 * Why mobile-owned (and not importing from packages/core/issues/ws-updaters):
 *   - Web's updaters reference `issueKeys` from `packages/core/issues/queries`,
 *     a different runtime instance than mobile's `data/queries/issue-keys.ts`.
 *     TanStack Query keys are compared structurally so this would *appear*
 *     to work, but binding cache mutation to a foreign key factory invites
 *     drift the moment either side adjusts its key shape.
 *   - Mobile cache shapes are simpler: no status-bucketed list, no children
 *     subtree, no childProgress, no label-byIssue cache. A direct mirror
 *     would be ~120 lines of conditional dead-code paths.
 *
 * Cache shapes (the design contract here):
 *   - Issue detail:    Issue                                  (keyed by detail(wsId, id))
 *   - Issue timeline:  TimelineEntry[]                        (keyed by timeline(wsId, id))
 *                      ASC oldest-first; new entries inserted at sorted position.
 *   - My Issues list:  InfiniteData<IssuePage>                (keyed by myList(wsId, scope, filter))
 *                      Multiple list caches per wsId (one per scope/filter combo).
 *                      Patch ALL of them via setQueriesData on myAll(wsId).
 *   - Workspace list:  InfiniteData<IssuePage>                (keyed by list(wsId))
 *                      Single cache per wsId (no scope/filter in the key —
 *                      filtering happens client-side off the same list).
 *   - Actor lists:     Issue[]                                (keyed by actorAll(wsId))
 *   - Gantt canvas:    Issue[]                                (keyed by list(wsId)/gantt)
 *
 * The three paginated surfaces hold `InfiniteData<IssuePage>` since iteration
 * 125, the rest are still flat `Issue[]`. Patchers therefore go through
 * `mapIssueRows` (data/queries/issue-list-cache) so one implementation covers
 * both shapes — a bare `old.filter(...)` would hit the `{pages, pageParams}`
 * envelope and throw.
 */
import type { QueryClient } from "@tanstack/react-query";
import type {
  Comment,
  Issue,
  IssueReaction,
  Label,
  Reaction,
  TimelineEntry,
} from "@multica/core/types";
import { issueKeys } from "@/data/queries/issue-keys";
import {
  mapIssueRows,
  upsertIssueRow,
  type IssueListCache,
} from "@/data/queries/issue-list-cache";

type TimelinePredicate = (entry: TimelineEntry) => boolean;
type TimelineMutate = (entry: TimelineEntry) => TimelineEntry;

// =====================================================
// Issue detail cache (single Issue per id)
// =====================================================

export function patchIssueDetail(
  qc: QueryClient,
  wsId: string,
  partial: Partial<Issue> & { id: string },
) {
  qc.setQueryData<Issue>(issueKeys.detail(wsId, partial.id), (old) =>
    old ? { ...old, ...partial } : old,
  );
}

export function clearIssueDetail(
  qc: QueryClient,
  wsId: string,
  issueId: string,
) {
  qc.removeQueries({ queryKey: issueKeys.detail(wsId, issueId) });
  qc.removeQueries({ queryKey: issueKeys.timeline(wsId, issueId) });
}

export function invalidateIssueAfterReconnect(
  qc: QueryClient,
  wsId: string,
  issueId: string,
) {
  qc.invalidateQueries({ queryKey: issueKeys.detail(wsId, issueId) });
  qc.invalidateQueries({ queryKey: issueKeys.timeline(wsId, issueId) });
  qc.invalidateQueries({ queryKey: issueKeys.attachments(wsId, issueId) });
  qc.invalidateQueries({ queryKey: issueKeys.activeTasks(wsId, issueId) });
  qc.invalidateQueries({ queryKey: issueKeys.tasks(wsId, issueId) });
}

// =====================================================
// Issue timeline (flat TimelineEntry[], ASC oldest-first)
// =====================================================

export function appendTimelineEntry(
  qc: QueryClient,
  wsId: string,
  issueId: string,
  entry: TimelineEntry,
) {
  qc.setQueryData<TimelineEntry[]>(
    issueKeys.timeline(wsId, issueId),
    (old) => {
      if (!old) return old;
      // Skip if the entry is already present — backend can re-emit on
      // reconnect or two clients can echo the same comment.
      if (old.some((e) => e.id === entry.id && e.type === entry.type)) {
        return old;
      }
      const next = [...old, entry];
      next.sort((a, b) => {
        if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
        return a.id < b.id ? -1 : 1;
      });
      return next;
    },
  );
}

export function patchTimelineEntry(
  qc: QueryClient,
  wsId: string,
  issueId: string,
  predicate: TimelinePredicate,
  mutate: TimelineMutate,
) {
  qc.setQueryData<TimelineEntry[]>(
    issueKeys.timeline(wsId, issueId),
    (old) => (old ? old.map((e) => (predicate(e) ? mutate(e) : e)) : old),
  );
}

export function removeTimelineEntry(
  qc: QueryClient,
  wsId: string,
  issueId: string,
  predicate: TimelinePredicate,
) {
  qc.setQueryData<TimelineEntry[]>(
    issueKeys.timeline(wsId, issueId),
    (old) => (old ? old.filter((e) => !predicate(e)) : old),
  );
}

/**
 * Cascade-delete a comment and every descendant reply (reply-to-reply
 * chains included). Mirrors the server's cascade in `comment.go:DeleteComment`
 * and web's `comment:deleted` handler at
 * `packages/views/issues/hooks/use-issue-timeline.ts:164-194`.
 *
 * Without this, removing only the root entry leaves the replies as
 * "orphans" — `buildTimelineRows` then promotes them to top-level rows
 * (its orphan-rescue branch), so the user would see ghost replies after a
 * thread delete on another client. Same-N rule violation.
 *
 * BFS rather than recursive Set-union: cheaper for arbitrary depth chains
 * and avoids recursion-depth concerns on large threads.
 */
export function removeCommentCascade(
  qc: QueryClient,
  wsId: string,
  issueId: string,
  commentId: string,
) {
  qc.setQueryData<TimelineEntry[]>(
    issueKeys.timeline(wsId, issueId),
    (old) => {
      if (!old) return old;
      const removed = new Set<string>([commentId]);
      // Iterate to fixed point — a single forward pass catches direct
      // children; later passes catch reply-to-reply chains. Bounded by
      // the timeline length, so worst case O(N²) on a degenerate chain
      // but N is p99 30 and chains are typically depth 1-2.
      let changed = true;
      while (changed) {
        changed = false;
        for (const e of old) {
          if (
            e.type === "comment" &&
            e.parent_id &&
            removed.has(e.parent_id) &&
            !removed.has(e.id)
          ) {
            removed.add(e.id);
            changed = true;
          }
        }
      }
      return old.filter(
        (e) => !(e.type === "comment" && removed.has(e.id)),
      );
    },
  );
}

// =====================================================
// My Issues list (flat Issue[] across many keys)
// =====================================================

export function patchMyIssuesList(
  qc: QueryClient,
  wsId: string,
  partial: Partial<Issue> & { id: string },
) {
  // myList is keyed by (wsId, scope, filter); we don't know which entries
  // the issue belongs to, so update every cached one. Any not-yet-loaded
  // list will fetch fresh on mount.
  qc.setQueriesData<IssueListCache>({ queryKey: issueKeys.myAll(wsId) }, (old) =>
    mapIssueRows(old, (rows) =>
      rows.map((i) => (i.id === partial.id ? { ...i, ...partial } : i)),
    ),
  );
}

export function removeFromMyIssuesList(
  qc: QueryClient,
  wsId: string,
  issueId: string,
) {
  qc.setQueriesData<IssueListCache>({ queryKey: issueKeys.myAll(wsId) }, (old) =>
    mapIssueRows(old, (rows) => rows.filter((i) => i.id !== issueId)),
  );
}

// =====================================================
// Workspace Issues list (flat Issue[] under list(wsId))
// =====================================================

export function patchIssuesList(
  qc: QueryClient,
  wsId: string,
  partial: Partial<Issue> & { id: string },
) {
  // list(wsId) is also a prefix of the filtered window keys
  // (listFiltered), so a prefix match reaches every cached window. Client
  // predicates re-run at render time (`applyIssueFilters` + `sortIssues`),
  // so a patched row drifting outside the active window is dropped there.
  qc.setQueriesData<IssueListCache>({ queryKey: issueKeys.list(wsId) }, (old) =>
    mapIssueRows(old, (rows) =>
      rows.map((i) => (i.id === partial.id ? { ...i, ...partial } : i)),
    ),
  );
}

/** True when the query belongs to the gantt canvas. Gantt row membership is
 *  decided server-side (scheduled ∧ optional My-Issues scope), so a blind
 *  workspace-wide create prepend would leak rows onto a canvas window they
 *  don't belong to — creates must invalidate these keys instead of
 *  prepending (same rule the actor panels follow for creates). */
function isGanttQueryKey(queryKey: readonly unknown[]): boolean {
  return queryKey.indexOf("gantt") !== -1;
}

export function prependToIssuesList(
  qc: QueryClient,
  wsId: string,
  issue: Issue,
) {
  // list(wsId) is also a prefix of the gantt canvas keys (and the filtered
  // window keys), so a prefix match reaches every cached list. Plain
  // windows re-filter at render time, so a prepend is safe there; a gantt
  // window has no client-side re-filter for server-decided membership, so
  // skip those caches and invalidate them instead — the refetch decides
  // whether the new issue belongs on the canvas.
  qc.setQueriesData<IssueListCache>(
    {
      queryKey: issueKeys.list(wsId),
      predicate: (query) => !isGanttQueryKey(query.queryKey),
    },
    // `upsertIssueRow`, not a `mapIssueRows` insert: the latter runs per page,
    // so "not present" would hold for every page and the row would be added to
    // each of them.
    (old) => upsertIssueRow(old, issue, "prepend"),
  );
  qc.invalidateQueries({ queryKey: [...issueKeys.list(wsId), "gantt"] });
}

export function removeFromIssuesList(
  qc: QueryClient,
  wsId: string,
  issueId: string,
) {
  qc.setQueriesData<IssueListCache>({ queryKey: issueKeys.list(wsId) }, (old) =>
    mapIssueRows(old, (rows) => rows.filter((i) => i.id !== issueId)),
  );
}

// =====================================================
// Actor Issues lists (member/agent detail "Issues" panels).
// Row membership is server-decided (assignee_filters/creator_filters), so
// creates must invalidate the actorAll(wsId) prefix instead of prepending —
// we can't know whether a new issue belongs to a given actor list. For
// updates/deletes the row is already present, so an in-place patch / removal
// reaches every cached actor list under the prefix.
// =====================================================

export function patchActorIssuesList(
  qc: QueryClient,
  wsId: string,
  partial: Partial<Issue> & { id: string },
) {
  qc.setQueriesData<IssueListCache>({ queryKey: issueKeys.actorAll(wsId) }, (old) =>
    mapIssueRows(old, (rows) =>
      rows.map((i) => (i.id === partial.id ? { ...i, ...partial } : i)),
    ),
  );
}

export function removeFromActorIssuesList(
  qc: QueryClient,
  wsId: string,
  issueId: string,
) {
  qc.setQueriesData<IssueListCache>({ queryKey: issueKeys.actorAll(wsId) }, (old) =>
    mapIssueRows(old, (rows) => rows.filter((i) => i.id !== issueId)),
  );
}

// =====================================================
// Reactions
// =====================================================

export function addCommentReaction(
  qc: QueryClient,
  wsId: string,
  issueId: string,
  commentId: string,
  reaction: Reaction,
) {
  patchTimelineEntry(
    qc,
    wsId,
    issueId,
    (e) => e.type === "comment" && e.id === commentId,
    (e) => ({
      ...e,
      reactions: [
        ...(e.reactions ?? []).filter((r) => r.id !== reaction.id),
        reaction,
      ],
    }),
  );
}

export function removeCommentReaction(
  qc: QueryClient,
  wsId: string,
  issueId: string,
  commentId: string,
  emoji: string,
  actorId: string,
) {
  patchTimelineEntry(
    qc,
    wsId,
    issueId,
    (e) => e.type === "comment" && e.id === commentId,
    (e) => ({
      ...e,
      reactions: (e.reactions ?? []).filter(
        (r) => !(r.emoji === emoji && r.actor_id === actorId),
      ),
    }),
  );
}

export function addIssueReaction(
  qc: QueryClient,
  wsId: string,
  issueId: string,
  reaction: IssueReaction,
) {
  qc.setQueryData<Issue>(issueKeys.detail(wsId, issueId), (old) => {
    if (!old) return old;
    const existing = old.reactions ?? [];
    if (existing.some((r) => r.id === reaction.id)) return old;
    return { ...old, reactions: [...existing, reaction] };
  });
}

export function removeIssueReaction(
  qc: QueryClient,
  wsId: string,
  issueId: string,
  emoji: string,
  actorId: string,
) {
  qc.setQueryData<Issue>(issueKeys.detail(wsId, issueId), (old) =>
    old
      ? {
          ...old,
          reactions: (old.reactions ?? []).filter(
            (r) => !(r.emoji === emoji && r.actor_id === actorId),
          ),
        }
      : old,
  );
}

// =====================================================
// Labels
// =====================================================

export function patchIssueLabels(
  qc: QueryClient,
  wsId: string,
  issueId: string,
  labels: Label[],
) {
  qc.setQueryData<Issue>(issueKeys.detail(wsId, issueId), (old) =>
    old ? { ...old, labels } : old,
  );
  qc.setQueriesData<IssueListCache>({ queryKey: issueKeys.myAll(wsId) }, (old) =>
    mapIssueRows(old, (rows) =>
      rows.map((i) => (i.id === issueId ? { ...i, labels } : i)),
    ),
  );
  qc.setQueriesData<IssueListCache>({ queryKey: issueKeys.list(wsId) }, (old) =>
    mapIssueRows(old, (rows) =>
      rows.map((i) => (i.id === issueId ? { ...i, labels } : i)),
    ),
  );
}

// =====================================================
// Helpers — payload normalization
// =====================================================

/**
 * Convert a Comment WS payload into a TimelineEntry. The two types share
 * most fields but use different actor-key names (Comment uses
 * `author_type/author_id`; TimelineEntry uses `actor_type/actor_id`).
 */
export function commentToTimelineEntry(comment: Comment): TimelineEntry {
  return {
    type: "comment",
    id: comment.id,
    actor_type: comment.author_type,
    actor_id: comment.author_id,
    created_at: comment.created_at,
    content: comment.content,
    parent_id: comment.parent_id,
    updated_at: comment.updated_at,
    comment_type: comment.type,
    reactions: comment.reactions,
    attachments: comment.attachments,
    // Carry resolve state through. Web's commentToTimelineEntry includes
    // these (`packages/views/issues/hooks/use-issue-timeline.ts:42-58`); the
    // earlier mobile copy dropped them, so a `comment:updated` event on a
    // resolved comment would silently strip the resolved flag from the
    // cache and the UI would un-dim.
    resolved_at: comment.resolved_at,
    resolved_by_type: comment.resolved_by_type,
    resolved_by_id: comment.resolved_by_id,
    source_task_id: comment.source_task_id,
  };
}
