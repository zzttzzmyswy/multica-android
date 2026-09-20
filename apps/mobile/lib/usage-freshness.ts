/**
 * Header freshness labels for the usage screen (iteration 171).
 *
 * Every number on the page is bucketed on the viewer's timezone, so the header
 * names that zone and when the figures behind it were last fetched. Without
 * them the same chart under a different zone reads as a different answer with
 * nothing on screen admitting it (web dashboard-page `useDataFreshness`).
 *
 * The tz string is stored user input and reaches us unvalidated: `Intl` throws
 * on a zone it does not recognise, and a header label is not worth taking the
 * page down for, so every format here degrades to null instead. Callers drop
 * the label when it comes back null.
 *
 * Pure and React-free so the Node-only vitest lane can pin it.
 */

/** Most recent successful fetch across the page's queries, or null if none has
 *  landed yet. React Query reports 0 for a query that never resolved; a
 *  non-finite stamp is not a time either and would poison the comparison. */
export function latestUpdatedAt(stamps: readonly number[]): number | null {
  let latest: number | null = null;
  for (const stamp of stamps) {
    if (!Number.isFinite(stamp) || stamp <= 0) continue;
    if (latest === null || stamp > latest) latest = stamp;
  }
  return latest;
}

/** Short zone name like "GMT+8" for the viewing timezone, or null when the
 *  zone is not one `Intl` recognises. */
export function formatTzLabel(
  viewTZ: string,
  locales?: Intl.LocalesArgument,
  now: Date = new Date(),
): string | null {
  try {
    return (
      new Intl.DateTimeFormat(locales, {
        timeZone: viewTZ,
        timeZoneName: "shortOffset",
      })
        .formatToParts(now)
        .find((part) => part.type === "timeZoneName")?.value ?? null
    );
  } catch {
    return null;
  }
}

/** Local `HH:mm` of `timestamp` in the viewing timezone, or null when there is
 *  no timestamp or the zone is unrecognised. */
export function formatUpdatedAt(
  timestamp: number | null,
  viewTZ: string,
  locales?: Intl.LocalesArgument,
): string | null {
  if (timestamp === null) return null;
  try {
    return new Intl.DateTimeFormat(locales, {
      timeZone: viewTZ,
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(timestamp));
  } catch {
    return null;
  }
}
