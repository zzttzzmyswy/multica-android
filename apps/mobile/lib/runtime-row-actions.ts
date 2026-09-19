/**
 * Which actions a machine-detail runtime row offers (iteration 167) — the pure
 * decision behind the row's kebab, kept out of the component so the Node-only
 * vitest lane pins it. Web counterpart: `RuntimeRowMenu`
 * (`packages/views/runtimes/components/runtime-list.tsx`).
 *
 * Web's menu also carries "open in new tab" (a browser affordance with no
 * phone meaning) and "edit custom runtime" (mobile has no profile-edit form
 * yet), so delete is the row's only management action here — as web's own
 * comment says it is there too.
 */
import type { AgentRuntime } from "@multica/core/types";

/**
 * `delete` drops a built-in runtime row; `delete-profile` takes a custom
 * runtime's profile registration away from the whole workspace. They are
 * separate actions because the consequences differ, matching web's
 * `delete_action` / `delete_profile_action` split.
 */
export type RuntimeRowAction = "delete" | "delete-profile";

export function runtimeRowActions(
  runtime: Pick<AgentRuntime, "profile_id"> | { profile_id?: string | null },
  options: { canDelete: boolean },
): RuntimeRowAction[] {
  // No kebab at all when the viewer may not delete: an empty sheet reads as
  // "I lost my permission" rather than "there is nothing here".
  if (!options.canDelete) return [];
  return [runtime.profile_id ? "delete-profile" : "delete"];
}

/** i18n key for the action sheet's destructive button — it must name what is
 *  actually removed, not the generic verb. */
export function runtimeDeleteConfirmLabelKey(
  runtime: Pick<AgentRuntime, "profile_id"> | { profile_id?: string | null },
): string {
  return runtime.profile_id ? "runtimes.row.deleteProfile" : "runtimes.row.delete";
}
