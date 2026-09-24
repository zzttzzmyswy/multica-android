/**
 * Workbench layout — the half of the issue workbench's shape that belongs to
 * the DEVICE rather than the server: the swimlane row order, which swimlanes
 * are folded, and which list sections are folded.
 *
 * Web keeps the same three in `packages/core/issues/stores/view-store.ts`
 * (`swimlaneOrders`, `collapsedSwimlanes`, `listCollapsedStatuses`) and
 * persists them to localStorage — they are deliberately NOT part of a saved
 * view's payload (`save-view-dialog.tsx` serialises only the filter and
 * display keys), so they never travel between machines. Mobile mirrors that
 * contract: per workspace, per device, in a JSON file (see
 * `data/stores/issue-workbench-layout-store.ts`).
 *
 * The folding and bucket-normalising rules are pure and live here so they run
 * in the Node vitest lane without a store, a React tree or a file system.
 */

/** Toggle `key` in a collapsed-key list, preserving first-seen order. */
export function toggleCollapsedKey(
  list: readonly string[],
  key: string,
): string[] {
  return list.includes(key)
    ? list.filter((entry) => entry !== key)
    : [...list, key];
}

/** Is `key` folded in `list`? Tolerates the absent bucket (nothing folded). */
export function isCollapsedKey(
  list: readonly string[] | undefined,
  key: string,
): boolean {
  return list?.includes(key) ?? false;
}

/**
 * Normalize one untrusted persisted key list: strings only, de-duplicated,
 * order preserved. Non-array input (corrupt file, a value from an older
 * shape) reads as "nothing folded" rather than throwing.
 */
export function normalizeKeyList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || entry.length === 0) continue;
    if (seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out;
}

/**
 * Normalize an untrusted persisted bucket map (`{ grouping: key[] }`). Buckets
 * that are not arrays are dropped; a bucket that normalizes to nothing is
 * dropped too, so an empty fold set never keeps an entry alive.
 *
 * Deliberately does NOT filter buckets against the groupings the current
 * screen knows about: the same file holds the `status` list bucket and the
 * `assignee` swimlane bucket, and dropping the ones a given surface cannot
 * render would erase them the first time another surface wrote.
 */
export function normalizeBuckets(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [bucket, value] of Object.entries(raw as Record<string, unknown>)) {
    const list = normalizeKeyList(value);
    if (list.length > 0) out[bucket] = list;
  }
  return out;
}

/**
 * Fold the named sections: a collapsed section keeps its header — with the
 * count it had — and loses its rows. Returns new objects, so the caller's
 * derived sections stay the untouched source of truth and un-folding is just
 * a re-run with a smaller set.
 *
 * The count rides on the section because `IssueSectionHeader` reads it from
 * there: emptying `data` would otherwise print "0" next to a folded group.
 */
export function collapseSections<T extends { key: string; data: unknown[] }>(
  sections: readonly T[],
  collapsed: ReadonlySet<string>,
): T[] {
  return sections.map((section) =>
    collapsed.has(section.key)
      ? ({ ...section, data: [], count: section.data.length } as T)
      : section,
  );
}
