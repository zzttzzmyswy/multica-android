/**
 * Pure display helpers for the workspace label catalogs.
 *
 * Web parity: `packages/views/settings/components/labels-tab.tsx` manages two
 * separate catalogs (`RESOURCE_TYPES = ["issue", "skill"]`), switches between
 * them with a scope control, and filters the active catalog with a free-text
 * query that matches name OR description, case-insensitively. Mobile mirrors
 * both here so the screen stays a thin renderer.
 */
import type { Label, LabelResourceType } from "@multica/core/types";

/**
 * The two catalogs the product exposes for management. Narrower than
 * `LabelResourceType`: the backend still models agent labels, but nothing in
 * the product creates, applies, or views them (web makes the same cut).
 */
export type LabelScope = Extract<LabelResourceType, "issue" | "skill">;

export const LABEL_SCOPES: readonly LabelScope[] = ["issue", "skill"];

/**
 * Which catalog a label belongs to. Legacy rows predate the `resource_type`
 * column and read as `issue` — the same default the server applies to an
 * unscoped `GET /api/labels`.
 */
export function labelScopeOf(label: Label): LabelScope {
  return label.resource_type === "skill" ? "skill" : "issue";
}

/**
 * Scope + free-text filter, mirroring web's `filteredLabels` memo. Scope is
 * re-checked here even though the list is already fetched per scope: the
 * issue catalog shares its cache entry with the issue pickers, so a stale or
 * cross-scoped row would otherwise leak into the wrong catalog's count.
 */
export function filterLabels(
  labels: readonly Label[],
  scope: LabelScope,
  query: string,
): Label[] {
  const normalized = query.trim().toLowerCase();
  return labels.filter((label) => {
    if (labelScopeOf(label) !== scope) return false;
    if (!normalized) return true;
    return (
      label.name.toLowerCase().includes(normalized) ||
      (label.description ?? "").toLowerCase().includes(normalized)
    );
  });
}
