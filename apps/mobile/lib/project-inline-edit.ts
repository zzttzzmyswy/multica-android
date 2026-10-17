/**
 * In-place editing decisions for the projects list (iteration 253, MYS-2202).
 *
 * Web's projects page lets a user change status, priority and lead **from the
 * row**, in both of its views: `packages/views/projects/components/
 * projects-page.tsx` mounts `ProjectStatusBadge` / `ProjectPriorityBadge` /
 * `ProjectLeadPicker` as table cells (`:406-460`) and again on the card
 * (`:613-680`), each writing through the page's `handleUpdate`. Mobile shipped
 * both views with those three columns as *static text*, so the only way to
 * change any of them was to open the project first — the last of the
 * "same action, two different endings" gaps on this surface.
 *
 * The mobile answer is a bottom sheet hosting the picker bodies the detail page
 * and its routes already use, exactly as `components/issue/table-cell-editor.tsx`
 * does for the issue table (MYS-1149): a phone column is ~80-140pt wide, so
 * web's in-place `DropdownMenu` has nowhere to render.
 *
 * This module holds the decisions that are worth being wrong about, kept free
 * of `react-native` and `@tanstack/*` so they are unit-testable in the Node
 * vitest lane (`vitest.config.ts` has no RN renderer):
 *
 *   - which columns a row may write in place, and when a cell gives way to
 *     multi-select;
 *   - how a lead is *named* — including the two states that are not a name:
 *     the directory has not answered yet, and there is no lead at all.
 */

import type { UpdateProjectRequest } from "@multica/core/types";

/** The projects-list columns a row can write in place. Mirrors the three cells
 *  web makes editable in both of its views. `progress` / `issues` / `created`
 *  are read-only on web too. */
export type ProjectCellColumn = "status" | "priority" | "lead";

export const PROJECT_EDITABLE_COLUMNS: readonly ProjectCellColumn[] = [
  "status",
  "priority",
  "lead",
];

export function isEditableProjectColumn(
  column: string,
): column is ProjectCellColumn {
  return (PROJECT_EDITABLE_COLUMNS as readonly string[]).includes(column);
}

/** i18n id for a column's editor-sheet heading. The same three words the table
 *  header and the filter chips already use, so one column never reads as two
 *  different things depending on where it is named. */
export const PROJECT_CELL_TITLE_KEY: Record<ProjectCellColumn, string> = {
  status: "projects.filterStatus",
  priority: "projects.filterPriority",
  lead: "projects.filterLead",
};

/**
 * Whether a cell may open its editor right now.
 *
 * The multi-select rule is the one the row's "⋯" already follows on this list
 * and on the other eight (`project-row-menu.tsx`, MYS-2197): in selection mode
 * a row carries one control, and picking is what the mode is for. A cell that
 * still opened a picker would swallow the tap that selects the row.
 *
 * Callers must ALSO have a write path — a view rendered without the edit
 * callback (the pinned screen's project rows) shows static cells, the same
 * contract `ProjectRowMenu`'s optional `menu` prop has.
 */
export function projectCellIsEditable(
  column: string,
  selectionMode: boolean,
): boolean {
  return !selectionMode && isEditableProjectColumn(column);
}

/** The lead a picker should mark as selected, read off a project. Mirrors the
 *  derivation the detail page's lead route performs
 *  (`app/(app)/[workspace]/project/[id]/picker/lead.tsx`), so the in-row sheet
 *  and the detail sheet check the same row. */
export function leadValueOf(project: {
  lead_type: "member" | "agent" | null;
  lead_id: string | null;
}): { type: "member" | "agent"; id: string } | null {
  return project.lead_type && project.lead_id
    ? { type: project.lead_type, id: project.lead_id }
    : null;
}

/** The patch a lead selection writes. `null` clears the lead — one spelling of
 *  the clear, shared by the picker body's Unassigned row and the detail page's
 *  route, so nothing sends `lead_type: "member"` with a null id. */
export function leadUpdatePatch(
  next: { type: "member" | "agent"; id: string } | null,
): UpdateProjectRequest {
  return next === null
    ? { lead_type: null, lead_id: null }
    : { lead_type: next.type, lead_id: next.id };
}

/**
 * The sentinels `useActorLookup().getName` returns when it cannot resolve an
 * actor — moved to `lib/actor-name-state.ts` in iteration 254, when the issue
 * table's CSV export and the new shared name primitive needed the same list.
 * Re-exported from here so the projects-list call sites and tests that already
 * import it keep one import path.
 */
export { isResolvedActorName, UNRESOLVED_ACTOR_NAMES } from "./actor-name-state";
import { isResolvedActorName } from "./actor-name-state";

export interface LeadCellInput {
  leadType: "member" | "agent" | null;
  leadId: string | null;
  /** The member AND agent directories settled (`useActorLookup().resolved`). */
  catalogsResolved: boolean;
  resolveName: (type: "member" | "agent", id: string) => string;
}

/**
 * What the lead cell may say.
 *
 *   - `name`    — an actor we can actually name. Includes the settled-but-gone
 *                 case, which renders the id's first 8 characters: web's
 *                 `useActorName` prints "Unknown Agent" there, and
 *                 `lib/actor-profile.ts` already chose the id fragment over
 *                 that dead end ("a row must still identify *which* member is
 *                 missing, and the two clients have to agree on what it
 *                 reads").
 *   - `pending` — the directories have not answered, so there is nothing true
 *                 to say yet.
 *   - `none`    — no lead, and the directories settled, so the absence is a
 *                 measurement rather than a guess.
 *
 * The `pending` state is the point of this function. A row that printed
 * 「未指派」 (or web's `lead.no_lead`) whenever `getName` came back empty would
 * be stating an absence it never observed — the read-side defect this repo
 * closed for pickers (`lib/catalog-state.ts`, MYS-1892/1907) and for records
 * (MYS-1908), reappearing in a cell. The lead column has no value of its own:
 * everything it shows comes from one of those two directories.
 */
export type ProjectLeadCell =
  | { kind: "name"; name: string }
  | { kind: "pending" }
  | { kind: "none" };

export function projectLeadCell(input: LeadCellInput): ProjectLeadCell {
  const { leadType, leadId, catalogsResolved, resolveName } = input;

  if (!leadType || !leadId) {
    return catalogsResolved ? { kind: "none" } : { kind: "pending" };
  }

  const name = resolveName(leadType, leadId);
  if (isResolvedActorName(name)) return { kind: "name", name };

  return catalogsResolved
    ? { kind: "name", name: leadId.slice(0, 8) }
    : { kind: "pending" };
}
