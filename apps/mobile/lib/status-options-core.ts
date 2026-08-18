/**
 * Pure status-options + custom-status helpers (MUL-6243) — no React, no i18n,
 * no expo, so the Node vitest lane can exercise them directly. The hooks in
 * `lib/status-options.ts` wrap these with the live catalog and i18n resolver.
 */
import type {
  IssueStatus,
  IssueStatusCategory,
  IssueStatusEntry,
} from "@multica/core/types";

export interface StatusOption {
  key: IssueStatus;
  label: string;
  /** `#rrggbb` for a custom status; null for a built-in (keeps its token color). */
  color: string | null;
  category: IssueStatusCategory;
}

export interface StatusOptionGroup {
  category: IssueStatusCategory;
  options: StatusOption[];
}

/**
 * Builds the status pick/filter option groups from a catalog's ACTIVE
 * entries. Mirrors web's `useStatusOptions`:
 *
 * - groups iterate every category in canonical order; a category with no
 *   active entries still offers its built-in (whose key IS the category) so a
 *   lifecycle step is never missing while the fetch is in flight.
 * - built-in entries keep `color: null` (their token color) no matter what the
 *   server seeds.
 * - `hasCustom` is true once any category holds more than one option.
 */
export function buildStatusOptionGroups(
  categories: readonly IssueStatusCategory[],
  activeEntries: readonly IssueStatusEntry[],
  labelOf: (statusKey: string) => string,
): { groups: StatusOptionGroup[]; options: StatusOption[]; hasCustom: boolean } {
  const groups = categories.map((category) => {
    const entries = activeEntries.filter((e) => e.category === category);
    const options: StatusOption[] =
      entries.length > 0
        ? entries.map((e) => ({
            key: e.key as IssueStatus,
            label: labelOf(e.key),
            color: e.is_system ? null : e.color,
            category,
          }))
        : [{ key: category, label: labelOf(category), color: null, category }];
    return { category, options };
  });
  return {
    groups,
    options: groups.flatMap((g) => g.options),
    hasCustom: groups.some((g) => g.options.length > 1),
  };
}

/**
 * Whether a status is a workspace CUSTOM status (so the chip should render).
 * `is_system` is the authority; the key/category comparison covers the window
 * before the catalog lands, where a built-in must still stay silent.
 */
export function isCustomStatus(
  entry: { is_system?: boolean; category?: IssueStatusCategory } | undefined,
  status: IssueStatus,
  categoryOf: (statusKey: string) => IssueStatusCategory,
): boolean {
  if (!entry) return false;
  return entry.is_system !== true && status !== categoryOf(status);
}