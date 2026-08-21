/**
 * Effective agent access scope — mirrors web
 * `packages/core/agents/effective-access.ts` 1:1 (MUL-3963). The three-state
 * scope shown in agent lists and filtered on is derived from the
 * authoritative `permission_mode` + `invocation_targets`; the legacy
 * `visibility` field is a lossy two-state projection and never consulted.
 */
import type { AgentInvocationTarget, AgentPermissionMode } from "@multica/core/types";

export type AccessScope = "workspace" | "specific-people" | "owner-only";

/**
 * Derive the effective access scope from an agent's permission fields. Fails
 * safe to "owner-only" when `permission_mode` is absent; a `public_to` agent
 * with absent `invocation_targets` stays "specific-people".
 */
export function effectiveAccessScope(
  permissionMode: AgentPermissionMode | undefined | null,
  invocationTargets: readonly AgentInvocationTarget[] | undefined | null,
): AccessScope {
  if (permissionMode !== "public_to") {
    return "owner-only";
  }
  if ((invocationTargets ?? []).some((t) => t.target_type === "workspace")) {
    return "workspace";
  }
  return "specific-people";
}

export const ALL_ACCESS_SCOPES: readonly AccessScope[] = [
  "workspace",
  "specific-people",
  "owner-only",
];

/**
 * Whether a bulk-access Apply is allowed for the picker's current change.
 * `null` (no selection) and `public_to` with zero invocation targets are not
 * ready.
 */
export function isAccessChangeReady(change: {
  permission_mode: AgentPermissionMode;
  invocation_targets: readonly { target_type: string }[];
} | null): boolean {
  if (!change) return false;
  if (change.permission_mode === "private") return true;
  return change.invocation_targets.length > 0;
}