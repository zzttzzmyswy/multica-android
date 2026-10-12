/**
 * Which actions a labels-LIST row offers — the pure half of the list-row kebab
 * added in iteration 231 (MYS-2102), mirroring web's row menu
 * (`packages/views/settings/components/labels-tab.tsx:186-211`).
 *
 * Before this round the row's only exit was `router.push` to the edit form, and
 * the list had no row menu at all: renaming one of this deployment's three
 * labels, or deleting one, meant opening it first. Both capabilities already
 * existed on the edit form (shared `LabelForm`) — what was missing was this
 * entry point.
 *
 * The one web rule mirrored here is the *absence* of a rule. Web's
 * `labels-tab.tsx` has no `canManage` anywhere — `grep canManage` over the whole
 * file returns nothing — and the `DropdownMenu` is rendered unconditionally
 * inside the row map. Every other settings tab on this screen family gates its
 * menu (`properties-tab.tsx:260` on `canManage`, `members-tab.tsx:112` on
 * `showMenu`); labels do not, and that is deliberate upstream, not an
 * oversight: labels are workspace-wide vocabulary that any member may curate.
 * The server is still the authority for the write itself, so a member the
 * server would reject gets a failed mutation rather than a hidden menu — which
 * is exactly what web ships.
 *
 * `open_in_new_tab` is the one web entry deliberately NOT ported: a phone has
 * no tabs and the row tap already opens the label — the same reason
 * `agent-row-menu.tsx`, `autopilot-row-menu.tsx` and `skill-row-menu.tsx` omit
 * it.
 */
import type { Label } from "@multica/core/types";

export type LabelRowAction = "edit" | "delete";

/** The slice of a list row the decisions read. */
export type LabelRowActionInput = Pick<Label, "id" | "name">;

/**
 * The kebab's items, in menu order (web renders edit, then delete).
 *
 * Unconditional, like web's. The helper exists anyway rather than the caller
 * inlining two literals, because it is the seam the wiring ratchet pins and the
 * place a future gate would go — putting the rule in JSX is how a per-row
 * permission check becomes untestable.
 */
export function labelRowActions(_row: LabelRowActionInput): LabelRowAction[] {
  return ["edit", "delete"];
}
