/**
 * Thread resolution derivation — the pure half of web's
 * `packages/views/issues/components/thread-utils.ts`
 * (`deriveThreadResolution`), plus the reply fold built on top of it.
 *
 * `resolved_at` is written by TWO user actions:
 *   - "Resolve thread" sets it on the ROOT → the whole thread folds into one
 *     bar (`ResolvedThreadBar`).
 *   - "Resolve thread with comment" sets it on a REPLY → that reply IS the
 *     resolution; the root and the resolution stay visible and the other
 *     replies fold behind a bar between them.
 *
 * The server enforces a single resolution per thread (resolving one comment
 * clears `resolved_at` on the others — `ClearOtherThreadResolutions`), but the
 * derivation stays total anyway: a thread that somehow carries several
 * resolved rows must still render exactly one resolution, never two and never
 * a crash. Root wins; otherwise the reply with the latest `resolved_at` is
 * THE resolution.
 *
 * No React / i18n imports: the module runs in the Node vitest lane.
 */
import type { TimelineEntry } from "@multica/core/types";

export type ThreadResolution =
  | { kind: "none" }
  | { kind: "root" }
  | { kind: "reply"; resolutionId: string };

/** Web `deriveThreadResolution`, ported field for field. */
export function deriveThreadResolution(
  root: TimelineEntry,
  replies: readonly TimelineEntry[],
): ThreadResolution {
  if (root.resolved_at) return { kind: "root" };
  let chosen: TimelineEntry | null = null;
  for (const reply of replies) {
    if (!reply.resolved_at) continue;
    if (!chosen || reply.resolved_at > chosen.resolved_at!) chosen = reply;
  }
  return chosen ? { kind: "reply", resolutionId: chosen.id } : { kind: "none" };
}

/**
 * The replies that fold behind the bar. Web's `foldedReplies`: every reply
 * except the resolution itself (the resolution stays pinned below the bar).
 * With no reply-resolution nothing folds, so callers can use this
 * unconditionally on the expanded render path.
 */
export function foldThreadReplies(
  replies: readonly TimelineEntry[],
  resolution: ThreadResolution,
): TimelineEntry[] {
  if (resolution.kind !== "reply") return [...replies];
  return replies.filter((reply) => reply.id !== resolution.resolutionId);
}

/**
 * IDs of every thread root (top-level comment) in a timeline — the units the
 * per-comment collapse store folds. Port of web's `rootCommentIds`
 * (`packages/views/issues/components/thread-utils.ts:69`): a comment is a root
 * iff it has no `parent_id`, the same root/reply split `lib/timeline-thread.ts`
 * groups on.
 */
export function rootCommentIds(entries: readonly TimelineEntry[]): string[] {
  return entries
    .filter((e) => e.type === "comment" && !e.parent_id)
    .map((e) => e.id);
}

/**
 * IDs of thread roots that carry a resolution (on the root itself or on a
 * reply) — the threads that render folded behind a bar until expanded. Port of
 * web's `resolvedThreadRootIds` (`thread-utils.ts:81`).
 *
 * Web sorts each root's descendants chronologically before deriving, because
 * its `deriveThreadResolution` picks the LATEST `resolved_at` among replies.
 * Here the answer only needs to know whether a resolution exists at all
 * (`kind !== "none"`), and that is order-independent: a root is resolved iff
 * the root itself is, or ANY descendant is. So the walk below collects the
 * reachable set and skips web's sort — same answer, without re-deriving an
 * order this predicate never reads.
 *
 * Unresolved roots are excluded on purpose (web's own note): seeding them into
 * the expand set would keep them expanded through a later resolve.
 */
export function resolvedThreadRootIds(
  entries: readonly TimelineEntry[],
): string[] {
  const roots: TimelineEntry[] = [];
  /** parent id → direct reply ids, so a root's thread is reachable. */
  const childrenByParent = new Map<string, string[]>();
  /** id → the row itself, for the resolution check on descendants. */
  const byId = new Map<string, TimelineEntry>();

  for (const e of entries) {
    if (e.type !== "comment") continue;
    byId.set(e.id, e);
    if (!e.parent_id) {
      roots.push(e);
      continue;
    }
    const list = childrenByParent.get(e.parent_id) ?? [];
    list.push(e.id);
    childrenByParent.set(e.parent_id, list);
  }

  /** Does any row in this root's thread carry a resolution? */
  const threadHasResolution = (root: TimelineEntry): boolean => {
    if (root.resolved_at) return true;
    const queue = [...(childrenByParent.get(root.id) ?? [])];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (byId.get(id)?.resolved_at) return true;
      queue.push(...(childrenByParent.get(id) ?? []));
    }
    return false;
  };

  return roots.filter(threadHasResolution).map((root) => root.id);
}
