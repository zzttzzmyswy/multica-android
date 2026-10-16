/**
 * The projects-list row-action gates (iteration 252, MYS-2197) — the mobile
 * port of web's `ProjectRowActions` menu
 * (`packages/views/projects/components/projects-page.tsx:222-320`).
 *
 * Before this round the row's only exit was `router.push` to the detail page,
 * and the list had no row menu at all: pinning a project, or deleting one, meant
 * opening it first. `projects` was the last of the nine list surfaces without a
 * kebab — the eight siblings (`agent` / `autopilot` / `label` / `member` /
 * `property` / `skill` / `squad` / `runtime`) each gained one between
 * iterations 229 and 231. The capabilities already existed (the detail page's
 * own "…" menu, and the long-press batch toolbar on this very list); what was
 * missing was this entry point.
 *
 * Three web rules are mirrored, each one a place a plausible edit silently
 * changes product semantics:
 *
 *   1. **`delete` needs `canDelete`** (`:283`). On web that prop is
 *      `isWorkspaceAdmin` (`:1258`, `:1279`, `:1289`) — a workspace owner or
 *      admin — and it gates the entry only; the server remains the authority.
 *      The same predicate already gates this list's batch delete, so the kebab
 *      and the toolbar agree on who may delete.
 *   2. **`pin` / `unpin` are one entry whose direction follows state**
 *      (`:281`): web renders `page.unpin` + `PinOff` when the project is
 *      pinned and `page.pin` + `Pin` otherwise.
 *   3. **Menu order** (web renders pin before the destructive separator):
 *      pin/unpin leads, `delete` sits last.
 *
 * `open_in_new_tab` is the one web entry deliberately NOT ported: a phone has
 * no tabs and the row tap already opens the project — the same reason
 * `agent-row-menu.tsx`, `autopilot-row-menu.tsx`, `skill-row-menu.tsx` and
 * `label-row-menu.tsx` omit it.
 *
 * ## The fourth rule is mobile's own, and it is why this helper takes a second
 * ## argument rather than reading `Project` alone
 *
 * Web derives `pinned` from its pin cache and renders a direction from it
 * unconditionally. That is a *claim about the workspace* built from a read that
 * may not have answered: the pin list is a per-user read
 * (`data/queries/pins.ts`), and when it is loading or failed every project
 * looks unpinned. A row menu that says 「置顶」 over a project the user already
 * pinned invites a duplicate write; one that says 「取消置顶」 over an unpinned
 * project offers to remove something that is not there. Either way the phone
 * states a fact nobody measured — the defect family this project swept in
 * MYS-1892 / MYS-1907 / MYS-2192 ("a read that has not settled may not be
 * spoken aloud"), and the issue for this round names it explicitly.
 *
 * So `pinsResolved` is required, and an unsettled pin list yields NO pin entry
 * rather than a guessed direction — the same "draw neither glyph" answer
 * `skillLockCell` gives an unresolved members read. A member with nothing left
 * to offer gets no kebab at all, which is what `runtimeRowActions` and
 * `autopilotRowActions` already do; the caller renders a hidden trigger, never
 * an empty sheet.
 */
import type { Project } from "@multica/core/types";

/**
 * `pin` / `unpin` are one action in two directions, exactly as web's single
 * `togglePin` is; they stay distinct codes so the menu routes each to its own
 * mutation and no caller has to re-derive the direction.
 */
export type ProjectRowAction = "pin" | "unpin" | "delete";

/** What the gating reads. `pinned` is only meaningful when `pinsResolved`. */
export interface ProjectRowActionInput {
  /** The project holds a pin in the viewer's own pin list. */
  pinned: boolean;
  /** The pin list settled (`ready` | `empty`), so `pinned === false` is
   *  measured rather than merely unread. */
  pinsResolved: boolean;
}

/**
 * The kebab's items, in menu order. `[]` is a real answer (a non-admin whose
 * pin list has not settled) and means "hide the trigger".
 */
export function projectRowActions(
  row: ProjectRowActionInput,
  options: { canDelete: boolean },
): ProjectRowAction[] {
  const actions: ProjectRowAction[] = [];
  // No pin entry until the pin list is the whole answer: in an unresolved state
  // both directions are unsupported, so neither is offered.
  if (row.pinsResolved) actions.push(row.pinned ? "unpin" : "pin");
  if (options.canDelete) actions.push("delete");
  return actions;
}

/** The i18n key for a row action. `pin` / `unpin` are the projects namespace's
 *  own verbs (already carried for this action; unused until this round), and
 *  the destructive entry reuses the batch toolbar's `delete` so one verb names
 *  one action across the list. */
export const PROJECT_ROW_ACTION_LABEL_KEY: Record<ProjectRowAction, string> = {
  pin: "projects.pin",
  unpin: "projects.unpin",
  delete: "projects.batchDelete",
};

/** Convenience for the callers that hold a `Project` plus the list's pin set. */
export function projectRowActionsFor(
  project: Pick<Project, "id">,
  pinnedIds: ReadonlySet<string>,
  pinsResolved: boolean,
  options: { canDelete: boolean },
): ProjectRowAction[] {
  return projectRowActions(
    { pinned: pinnedIds.has(project.id), pinsResolved },
    options,
  );
}
