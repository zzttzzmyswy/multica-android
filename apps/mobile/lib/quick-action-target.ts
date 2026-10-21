/**
 * The quick-action target, as three pure decisions.
 *
 * Each of these is a place where an empty `assignee_type` and a broken binding
 * look the same from the outside and mean opposite things, so each is worth
 * exercising without a renderer. The mobile vitest lane is Node-only (see
 * `vitest.config.ts`), which is why they live here rather than inline in the
 * form and the settings row.
 *
 * The server draws the same distinction and mobile has to agree with it:
 * `validateQuickActionAssignee` accepts exactly the pair `("", "")` as "mention
 * nobody", and `resolveQuickActionTarget` returns `Found: true` for it — so a
 * targetless action comes back with `target_missing: false`, `target_name: ""`,
 * and `target_public` read as if it had a public target. Reading any of those
 * three at face value turns a deliberate configuration into a broken one.
 */
import type { QuickAction, QuickActionAssigneeType } from "@multica/core/types";

/** A chosen binding, or `null` for "no target". */
export interface QuickActionTargetChoice {
  type: Exclude<QuickActionAssigneeType, "">;
  id: string;
}

/**
 * The create/PATCH payload for a binding.
 *
 * An empty PAIR — not an omitted field, not `null`. Two separate requirements
 * force the shape:
 *
 *   - the server recognises `("", "")` and nothing else as targetless; an
 *     empty type beside a real id is a 400;
 *   - PATCH reads an absent key as "leave this column alone", so omitting the
 *     fields when the author clears the target reports success and keeps the
 *     old binding. Sending the empty pair is the only way to unbind.
 *
 * Web sends the same pair (`quick-actions-tab.tsx`: `assignee_type:
 * form.assigneeId ? form.assigneeType : ""`).
 */
export function quickActionTargetPayload(target: QuickActionTargetChoice | null): {
  assignee_type: QuickActionAssigneeType;
  assignee_id: string;
} {
  return target
    ? { assignee_type: target.type, assignee_id: target.id }
    : { assignee_type: "", assignee_id: "" };
}

/**
 * What a saved action's binding actually is.
 *
 *   - `none`     — deliberately unbound. READ THIS FIRST: `target_missing` is
 *                  false for it, so a check ordered the other way would fall
 *                  through to printing the (empty) target name.
 *   - `missing`  — bound to an agent or squad that was archived or deleted.
 *   - `mismatched` — public action, target that the whole team cannot invoke.
 *                  Plain metadata, not a verdict: it reads as visibly wrong
 *                  beside the binding without a bespoke error state.
 *   - `ok`       — a binding that resolves and honours its visibility.
 */
export type QuickActionTargetState =
  | "none"
  | "missing"
  | "mismatched"
  | "ok";

export function quickActionTargetState(
  action: Pick<
    QuickAction,
    "assignee_type" | "target_missing" | "target_public" | "visibility"
  >,
): QuickActionTargetState {
  if (action.assignee_type === "") return "none";
  if (action.target_missing === true) return "missing";
  if (action.visibility === "public" && action.target_public !== true) {
    return "mismatched";
  }
  return "ok";
}

/**
 * Whether Save should be enabled.
 *
 * Three requirements, not four — web's rule (`quick-actions-tab.tsx:466-469`).
 * The target used to be mandatory here, which made "post this comment without
 * mentioning anyone" impossible to author on the phone even though the server
 * accepts it.
 *
 * `templateToken` is the offending snippet itself (or null): the server rejects
 * any `{{...}}`, and saying so while the author types beats a 400 on submit.
 */
export function quickActionCanSave(form: {
  name: string;
  prompt: string;
  templateToken: string | null;
}): boolean {
  return (
    form.name.trim().length > 0 &&
    form.prompt.trim().length > 0 &&
    form.templateToken === null
  );
}

/**
 * Whether the issue-sidebar row prints "runs as {name}".
 *
 * The sentence answers "who will this call", and for a targetless action the
 * answer is nobody — printing it over the fallback word ("the agent") would
 * name a target that does not exist. Web renders the line only when
 * `assignee_type !== ""` (`quick-actions-section.tsx`).
 */
export function quickActionShowsRunsAs(
  action: Pick<QuickAction, "assignee_type">,
): boolean {
  return action.assignee_type !== "";
}
