/**
 * Assignee-picker ordering by the signed-in user's own assignment history.
 *
 * Web's assignee picker (`packages/views/issues/components/pickers/assignee-picker.tsx:117-140`)
 * folds `/api/assignee-frequency` into a `Map` keyed `"<type>:<id>"` and sorts
 * each of its three sections by that number, descending. Mobile skipped the
 * whole thing (the old file header said so outright: "mobile skips
 * frequency-sort; alphabetical instead"), so the same directory answered the
 * same question in a different order on the phone — a user who assigns to the
 * same three agents every day scrolled past everyone else to reach them.
 *
 * Kept out of the component so the ordering rules are unit-testable without a
 * renderer (mobile's vitest lane is Node-only — see vitest.config.ts).
 *
 * Two rules matter and are easy to get wrong:
 *
 *   - **Absent means zero, not "sort last among the absent".** A member with
 *     no history and a member the endpoint has never heard of both rank 0.
 *     The endpoint only returns rows for actors it has counted, so most of a
 *     directory is absent on a fresh workspace.
 *   - **Ties keep the caller's order.** `Array.prototype.sort` is
 *     spec-guaranteed stable (ES2019+; Hermes follows), but relying on that
 *     silently couples this to the engine. The comparator returns 0 for equal
 *     frequencies and the input is a copy, so callers pass their rows already
 *     alphabetical and get alphabetical within each frequency band.
 */
import type { AssigneeFrequencyEntry } from "@multica/core/types";

/**
 * Fold the endpoint's rows into a `"<type>:<id>"` → frequency lookup, exactly
 * the key web builds. A later row for the same key wins, matching web's
 * `map.set` loop; the server already aggregates per key, so a duplicate would
 * be a server bug and this is only about not crashing on it.
 *
 * Rows missing either identifier are skipped: `":u1"` and `"member:"` are keys
 * no lookup will ever produce, so keeping them would only inflate the map.
 */
export function buildAssigneeFrequencyMap(
  entries: readonly AssigneeFrequencyEntry[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.assignee_type || !entry.assignee_id) continue;
    map.set(`${entry.assignee_type}:${entry.assignee_id}`, entry.frequency);
  }
  return map;
}

/** Frequency for one actor; 0 when the endpoint counts no history for it. */
export function assigneeFrequencyOf(
  map: ReadonlyMap<string, number>,
  type: string,
  id: string,
): number {
  return map.get(`${type}:${id}`) ?? 0;
}

/**
 * Copy `rows` ordered by the actor's frequency, descending. `keyOf` extracts
 * the `[type, id]` pair the lookup is built from, so one function serves the
 * member / agent / squad sections without three near-identical comparators.
 *
 * The input array is not mutated — the caller's list is usually a `useMemo`
 * result that other surfaces still read in its own order.
 */
export function sortByAssigneeFrequency<T>(
  rows: readonly T[],
  map: ReadonlyMap<string, number>,
  keyOf: (row: T) => readonly [string, string],
): T[] {
  return [...rows].sort((a, b) => {
    const [aType, aId] = keyOf(a);
    const [bType, bId] = keyOf(b);
    return (
      assigneeFrequencyOf(map, bType, bId) -
      assigneeFrequencyOf(map, aType, aId)
    );
  });
}
