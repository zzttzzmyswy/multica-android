/**
 * Which actions a properties-LIST row offers — the pure half of the list-row
 * kebab added in iteration 231 (MYS-2102), mirroring web's row menu
 * (`packages/views/settings/components/properties-tab.tsx:260-315`).
 *
 * Before this round the row's only exit was `router.push` to the edit form, so
 * archiving (or restoring) this deployment's `Severity` property meant opening
 * it first. Both writes already existed on the edit form — what was missing was
 * this entry point.
 *
 * Two web rules are mirrored verbatim, each one a place a plausible edit
 * silently changes product semantics:
 *
 *   1. **The whole kebab is gated on `canManage`** (`:260`), and the false
 *      branch renders an empty `<span />` — a *placeholder*, not a disabled
 *      button (`:313`). A property definition is workspace-wide schema, so
 *      unlike labels (see `label-row-actions.ts`) this surface is
 *      owner/admin-only, and web's own toolbar carries the matching
 *      `editor.admin_hint` for everyone else. Mobile's list already renders
 *      that same hint, so the menu simply does not appear.
 *   2. **Archive adapts per row** (`:278`): `archived ? 恢复 : 归档`. A single
 *      fixed "archive" item would be a dead entry on an already-archived row —
 *      which the list shows whenever "Show archived" is on — and the server
 *      rejects archiving twice ("property already archived").
 *
 * The restore branch writes immediately in web (no confirm); only archive goes
 * through `pendingArchive` / `ArchivePropertyDialog`. Mirroring that asymmetry
 * matters: restore is recoverable in one more tap, archive is what the dialog
 * exists to make deliberate.
 *
 * `open_in_new_tab` is not ported, for the same reason as the other three list
 * surfaces this round: a phone has no tabs and the row tap already opens the
 * property.
 */
import type { IssueProperty } from "@multica/core/types";

export type PropertyRowAction = "edit" | "archive" | "restore";

/** The slice of a list row the decisions read. */
export type PropertyRowActionInput = Pick<IssueProperty, "id" | "name" | "archived">;

/**
 * Web's `canManage` (`:123`): `role === "owner" || role === "admin"`. Kept as
 * a named predicate rather than an inline test so the wiring ratchet can assert
 * the screen uses *this* rule and not a hand-rolled one.
 */
export function canManageProperties(
  role: "owner" | "admin" | "member" | null | undefined,
): boolean {
  return role === "owner" || role === "admin";
}

/**
 * The kebab's items, in menu order. Empty for a member without `canManage` —
 * the caller renders no trigger at all rather than an empty sheet, matching
 * web's empty `<span />`.
 */
export function propertyRowActions(
  row: PropertyRowActionInput,
  options: { canManage: boolean },
): PropertyRowAction[] {
  if (!options.canManage) return [];
  return ["edit", row.archived ? "restore" : "archive"];
}

/**
 * Whether the archive branch needs the confirm dialog. Web's archive goes
 * through `pendingArchive`; its restore writes straight through. Exported so
 * the asymmetry is asserted in a test rather than only visible in JSX.
 */
export function propertyRowActionNeedsConfirm(action: PropertyRowAction): boolean {
  return action === "archive";
}
