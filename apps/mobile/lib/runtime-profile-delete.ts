/**
 * Which OBJECT a runtime row's destructive action removes (iteration 258,
 * MYS-2236) — the decision web splits across two dialogs and mobile used to
 * collapse into one.
 *
 * Web's `RuntimeRowMenu` renders `delete_action` / `delete_profile_action`
 * from the same `isCustomRuntime` test that picks the dialog
 * (`runtime-list.tsx:600-630`):
 *
 *   custom runtime  → DeleteRuntimeProfileDialog → DELETE
 *                     /api/workspaces/:ws/runtime-profiles/:id
 *   built-in runtime → DeleteRuntimeDialog        → DELETE
 *                     /api/runtimes/:id (with the unbind-agents cascade)
 *
 * Mobile had the LABEL right and the ACTION wrong: both entries called
 * `useDeleteRuntimeFlow`, so "Delete from workspace" tore down the machine's
 * runtime instance while the profile registration — the thing the label
 * promises to remove, and the only thing every other machine's identical row
 * depends on — stayed behind. The confirmation copy described one object and
 * the request destroyed another.
 *
 * This module is the single place that answers "which endpoint", so the row
 * menu and the detail page cannot drift apart again, and so the answer is
 * testable without a renderer.
 */

/** The two destructive endpoints, as data. `profileId` / `runtimeId` are kept
 *  apart rather than folded into one `id` field on purpose: a caller that
 *  mixed them up would still typecheck with a shared field name. */
export type RuntimeDeleteTarget =
  | { kind: "profile"; profileId: string }
  | { kind: "runtime"; runtimeId: string };

interface RuntimeLike {
  id?: string | null;
  profile_id?: string | null;
}

/**
 * The object a row's delete entry removes, or null when there is nothing to
 * name yet (a loading/absent runtime, or a row missing its id).
 *
 * A non-empty `profile_id` means the runtime is an instance of a workspace
 * custom profile — web's `isCustomRuntime`. Everything else is a built-in
 * runtime and is deleted as an instance.
 */
export function runtimeDeleteTarget(
  runtime: RuntimeLike | null | undefined,
): RuntimeDeleteTarget | null {
  if (!runtime) return null;
  const profileId = runtime.profile_id;
  if (typeof profileId === "string" && profileId.length > 0) {
    return { kind: "profile", profileId };
  }
  const runtimeId = runtime.id;
  if (typeof runtimeId === "string" && runtimeId.length > 0) {
    return { kind: "runtime", runtimeId };
  }
  return null;
}

/**
 * Run the delete a target names. Split out from the components so a unit test
 * can assert the routing against spies instead of grepping source: the defect
 * this replaces was exactly "both branches called the same function".
 */
export function dispatchRuntimeDelete(
  target: RuntimeDeleteTarget,
  deps: {
    deleteProfile: (profileId: string) => void;
    deleteRuntime: (runtimeId: string) => void;
  },
): void {
  if (target.kind === "profile") {
    deps.deleteProfile(target.profileId);
    return;
  }
  deps.deleteRuntime(target.runtimeId);
}

/**
 * What a failed profile delete means for the confirmation dialog.
 *
 * Web's `DeleteRuntimeProfileDialog` (`delete-runtime-profile-dialog.tsx:57-77`)
 * makes one distinction that the runtime flow does not have: a 409 "agents
 * are still bound" is NOT a failure the dialog should close on. It keeps the
 * dialog open and prints the server's reason above the buttons, because the
 * refusal is a question ("which agents?") the admin can answer by going and
 * unbinding them — dismissing the dialog would leave them with a toast and no
 * way back.
 *
 * Every other error is an ordinary failure: the dialog may close (or stay,
 * the caller decides) but there is nothing to explain inline.
 */
export interface ProfileDeleteFailure {
  /** True only for the bounded-agents refusal — the dialog must stay open. */
  keepsDialogOpen: boolean;
  /** Sentence to show. For a bound refusal it is the server's own wording
   *  when present, else the caller's localized fallback. */
  message: string;
  /** True when `message` came from the server (a bound refusal), false when it
   *  is the caller's generic copy — the dialog styles the two the same way,
   *  but the distinction keeps the fallback honest in tests. */
  fromServer: boolean;
}

/**
 * Classify a profile-delete error. `parse` is injected so this module stays
 * free of the api layer (`lib/runtime-profile-conflict.ts` owns the 409
 * shape) and the vitest lane can exercise it without native stubs.
 */
export function classifyProfileDeleteFailure(
  err: unknown,
  parse: (err: unknown) => { message: string } | null,
  fallback: string,
): ProfileDeleteFailure {
  const conflict = parse(err);
  if (conflict) {
    const serverMessage = conflict.message.trim();
    return serverMessage.length > 0
      ? { keepsDialogOpen: true, message: serverMessage, fromServer: true }
      : { keepsDialogOpen: true, message: fallback, fromServer: false };
  }
  const message =
    err instanceof Error && err.message.trim().length > 0
      ? err.message
      : fallback;
  return { keepsDialogOpen: false, message, fromServer: false };
}
