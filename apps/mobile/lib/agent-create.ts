/**
 * Pure helpers for the manual agent-create form (more/agents/new/manual).
 * Free of React/RN so the submit gate and error classification are
 * unit-testable. Mirrors the web-side logic in
 * packages/views/agents/create/use-create-agent-form.ts and
 * use-create-agent-submit.ts — the same predicates, the same 409 → name
 * conflict split.
 */
import {
  isDraftDescriptionWithinLimit,
  type AgentDraft,
} from "@multica/core/agents";
import { isRuntimeUsableForUser } from "@multica/core/runtimes";
import type { RuntimeDevice } from "@multica/core/types";

/** The subset of workspace runtimes the current member may create an agent
 *  on: online AND usable (owner of a private runtime, or member of a public
 *  one). Mirrors `useCreateAgentForm`'s `usableRuntimes`. */
export function usableRuntimes(
  runtimes: RuntimeDevice[],
  currentUserId: string | null,
): RuntimeDevice[] {
  return runtimes.filter(
    (runtime) =>
      runtime.status === "online" &&
      isRuntimeUsableForUser(runtime, currentUserId),
  );
}

export interface AgentCreateGate {
  nameMissing: boolean;
  runtimeMissing: boolean;
  accessInvalid: boolean;
  descriptionOverLimit: boolean;
}

/** Every non-name precondition the create button depends on. Mirrors web's
 *  `draftReady` (use-create-agent-form.ts): the selected runtime must be
 *  usable, the description within the server's 255-char cap, and a
 *  "members" scope must name at least one member. */
export function agentCreateGate(
  draft: AgentDraft,
  selectedRuntime: RuntimeDevice | null,
  currentUserId: string | null,
): AgentCreateGate {
  const accessInvalid =
    draft.permissionScope === "members" &&
    draft.memberIds.size === 0 &&
    draft.teamIds.size === 0;
  const runtimeUsable =
    selectedRuntime != null &&
    isRuntimeUsableForUser(selectedRuntime, currentUserId);
  return {
    nameMissing: draft.name.trim().length === 0,
    runtimeMissing: !runtimeUsable,
    accessInvalid,
    descriptionOverLimit: !isDraftDescriptionWithinLimit(draft.description),
  };
}

export interface AgentCreateErrors {
  /** Inline error under the name field — a 409 is a field error, not a form
   *  error: the user resolves it by typing a different name. */
  nameError: string | null;
  /** Generic form-level submit error (network, 400, …). */
  formError: string | null;
}

/** Mirrors web's `classifyAgentCreateError`: a 409 (duplicate name) is
 *  attributed to the name field so the form can point at it inline; every
 *  other failure surfaces as a form-level message. */
export function classifyAgentCreateError(
  error: unknown,
  fallbackMessage: string,
  conflictMessage: string,
): AgentCreateErrors {
  const status =
    typeof error === "object" && error !== null
      ? (error as { status?: unknown }).status
      : undefined;
  const message =
    error instanceof Error && error.message ? error.message : fallbackMessage;
  return status === 409
    ? { nameError: conflictMessage, formError: null }
    : { nameError: null, formError: message };
}