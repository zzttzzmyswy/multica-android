/**
 * Which actions a machine-detail runtime row offers (iteration 167) — the pure
 * decision behind the row's kebab, kept out of the component so the Node-only
 * vitest lane pins it. Web counterpart: `RuntimeRowMenu`
 * (`packages/views/runtimes/components/runtime-list.tsx`).
 *
 * Web's menu also carries "open in new tab", a browser affordance with no
 * phone meaning, so it is dropped here. Its other entry — "edit custom
 * runtime", shown when the runtime is custom AND its profile is on hand
 * (`runtime-list.tsx:592-599`) — is offered on the same terms: a built-in
 * runtime has no profile to edit, and a custom runtime whose profile has not
 * loaded has nothing to open a form with.
 */
import type { AgentRuntime } from "@multica/core/types";

/**
 * `edit` opens the runtime-profile form for a custom runtime; `delete` drops a
 * built-in runtime row; `delete-profile` takes a custom runtime's profile
 * registration away from the whole workspace. Delete splits in two because the
 * consequences differ, matching web's `delete_action` / `delete_profile_action`
 * pair.
 */
export type RuntimeRowAction = "edit" | "delete" | "delete-profile";

export function runtimeRowActions(
  runtime: Pick<AgentRuntime, "profile_id"> | { profile_id?: string | null },
  options: { canDelete: boolean; canEdit?: boolean },
): RuntimeRowAction[] {
  const actions: RuntimeRowAction[] = [];
  // Edit leads: it is the only non-destructive entry, and it is what the row
  // is usually opened for.
  if (options.canEdit && runtime.profile_id) actions.push("edit");
  // No delete entry when the viewer may not delete. The kebab itself survives
  // if there is still an edit to offer, so a non-admin owner of a custom
  // runtime is not left with no way in.
  if (options.canDelete) {
    actions.push(runtime.profile_id ? "delete-profile" : "delete");
  }
  return actions;
}

/** i18n key for the action sheet's destructive button — it must name what is
 *  actually removed, not the generic verb. */
export function runtimeDeleteConfirmLabelKey(
  runtime: Pick<AgentRuntime, "profile_id"> | { profile_id?: string | null },
): string {
  return runtime.profile_id ? "runtimes.row.deleteProfile" : "runtimes.row.delete";
}
