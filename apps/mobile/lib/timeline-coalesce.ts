/**
 * Coalesces consecutive identical activity entries. The exact rule is mirrored
 * from packages/views/issues/components/issue-detail.tsx:841-866 — this is a
 * behavioral parity gate: mobile must show the same N timeline entries as
 * web/desktop after coalescing (apps/mobile/CLAUDE.md "Counts and visibility
 * must agree").
 *
 * Rule (ASC chronological input):
 *   - Walk the array in order. If the next entry is an activity with
 *     identical (action, actor_type, actor_id) as the previous **top-level**
 *     entry, AND either
 *       (a) the action is `task_completed` / `task_failed` (no time limit), or
 *       (b) the gap is ≤ 2 minutes,
 *     merge it: bump `coalesced_count` and replace the previous entry's body
 *     with the newer one (preserves the newest timestamp/actor).
 *   - Top-level means activities and root comments — a reply carries a
 *     `parent_id`, renders nested under its parent, and therefore neither
 *     coalesces nor breaks a run. Matches web, which coalesces `topLevel`.
 *   - `squad_leader_evaluated` NEVER coalesces — each entry carries unique
 *     audit data (outcome + reason) and merging would drop the second
 *     evaluation's context. Matches web.
 *   - Comments never coalesce (each is its own entry).
 *
 * Returns a new array; the input is not mutated.
 */
import type { TimelineEntry } from "@multica/core/types";

const COALESCE_MS = 2 * 60 * 1000;
const NO_TIME_LIMIT_ACTIONS = new Set(["task_completed", "task_failed"]);
const NEVER_COALESCE_ACTIONS = new Set(["squad_leader_evaluated"]);

export function coalesceTimeline(
  entries: TimelineEntry[],
): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  // Index in `out` of the last entry web would call top-level. Web coalesces
  // `topLevel` — activities plus root comments — and renders a reply nested
  // under its parent, so a reply never interrupts a run of identical
  // activities. Comparing against the immediately preceding entry instead made
  // `[activity A, reply R, activity A]` two rows on the phone where web shows
  // one row with a ×2 chip.
  let prevTopLevel = -1;
  for (const entry of entries) {
    if (entry.type === "activity") {
      const prev = prevTopLevel >= 0 ? out[prevTopLevel] : undefined;
      if (
        !NEVER_COALESCE_ACTIONS.has(entry.action ?? "") &&
        prev?.type === "activity" &&
        prev.action === entry.action &&
        prev.actor_type === entry.actor_type &&
        prev.actor_id === entry.actor_id &&
        (NO_TIME_LIMIT_ACTIONS.has(entry.action ?? "") ||
          Math.abs(
            new Date(entry.created_at).getTime() -
              new Date(prev.created_at).getTime(),
          ) <= COALESCE_MS)
      ) {
        out[prevTopLevel] = {
          ...entry,
          coalesced_count: (prev.coalesced_count ?? 1) + 1,
        };
        continue;
      }
      prevTopLevel = out.length;
      out.push(entry);
      continue;
    }
    // A reply renders nested under its parent, so it neither coalesces nor
    // breaks a run of activities. Everything else is top-level.
    if (!(entry.type === "comment" && entry.parent_id)) {
      prevTopLevel = out.length;
    }
    out.push(entry);
  }
  return out;
}
