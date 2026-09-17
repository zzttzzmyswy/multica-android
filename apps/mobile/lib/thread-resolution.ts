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
