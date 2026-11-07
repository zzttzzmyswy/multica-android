/**
 * Resolving a status KEY to a label outside React.
 *
 * The alert channel runs outside any component — `data/query-client.ts` calls
 * it from the `MutationCache`, which has no hook context — so
 * `useStatusLabel` is unavailable there. This is the non-hook equivalent, and
 * it exists because the workflow refusals name statuses in the server's
 * vocabulary: `allowed_statuses` arrives as `["todo", "in_progress", "done"]`,
 * and printing those raw on a Chinese client is exactly the "raw id on screen"
 * defect this repo has already fixed twice (MYS-2433, MYS-2777).
 *
 * Resolution order matches `useStatusLabel`:
 *
 * 1. a built-in key → the i18n enum label;
 * 2. anything else → the workspace catalog's own name, read from the query
 *    cache (the catalog is loaded by every surface that can produce a status
 *    write, so it is warm in practice);
 * 3. no catalog, or an unknown key → the raw key. Deliberately the raw key and
 *    not a guess: an unknown custom status has a real name in the server's
 *    data, and inventing "Unknown" would hide which status the message is
 *    about.
 */
import type { IssueStatusEntry } from "@multica/core/types";
import { isIssueStatusCategory } from "@/lib/issue-status-catalog";
import { translate } from "@/lib/i18n";

/**
 * i18n label for a built-in key, the catalog's name for a custom one.
 *
 * `t` is injected (defaulting to the app store's `translate`) so the Node
 * vitest lane can drive this without pulling in the i18n module's SecureStore
 * dependency — the same reason `write-failure.ts` takes its translator as an
 * argument.
 */
export function statusLabelFromCatalog(
  statusKey: string,
  catalog: readonly IssueStatusEntry[] | undefined,
  t: (id: string) => string = translate,
): string {
  if (!statusKey) return "";
  if (isIssueStatusCategory(statusKey)) {
    const label = t(`enum.status.${statusKey}`);
    // A missing translation returns the id itself; showing `enum.status.todo`
    // is worse than the key, because it looks like a bug rather than a status.
    return label === `enum.status.${statusKey}` ? statusKey : label;
  }
  const entry = catalog?.find((row) => row.key === statusKey);
  return entry?.name || statusKey;
}

/**
 * The label resolver the alert channel uses: no hook context, so the caller
 * hands in the already-fetched catalog.
 *
 * Takes the catalog instead of reaching for a query client on purpose. The
 * alert runs from `data/query-client.ts`, which owns that client — importing
 * it back here would be a cycle (`query-client` → `write-failure` →
 * `status-label-alert` → `query-client`), and a cycle inside the module every
 * mutation's error path loads is not worth the saved argument.
 *
 * A missing catalog is not an error — it means none has been fetched in this
 * process yet, and the built-in keys still resolve through i18n.
 */
export function alertStatusLabel(
  statusKey: string,
  catalog: readonly IssueStatusEntry[] | undefined,
): string {
  return statusLabelFromCatalog(statusKey, catalog);
}
