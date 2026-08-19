/**
 * Headless runtime-management helpers — permission derivation, delete-plan
 * conflict parsing, and the online-local-daemon predicate. Kept free of RN
 * imports so the vitest lane exercises them directly; the detail page composes
 * them with the query layer.
 */

export interface RuntimePermissionContext {
  members: ReadonlyArray<{ role: string; user_id: string }>;
  currentUserId: string | null;
  runtime: { owner_id: string | null; profile_id?: string | null };
}

export interface RuntimePermissionDerivation {
  /** Current member is owner or admin of the workspace (MUL-6126). */
  isAdmin: boolean;
  /** Current user registered this runtime on their machine. */
  isRuntimeOwner: boolean;
  /** Rename / general edit affordance — admin or owner. */
  canEditRuntime: boolean;
  /** Built-in: admin or owner. Custom runtime: admin only (MUL-5559). */
  canDelete: boolean;
  /** Owner only — sharing a machine with the workspace is their call. */
  canEditVisibility: boolean;
}

export function deriveRuntimePermissions({
  members,
  currentUserId,
  runtime,
}: RuntimePermissionContext): RuntimePermissionDerivation {
  const isAdmin =
    !!currentUserId &&
    members.some(
      (m) =>
        m.user_id === currentUserId &&
        (m.role === "owner" || m.role === "admin"),
    );
  const isRuntimeOwner =
    !!currentUserId && runtime.owner_id !== null && runtime.owner_id === currentUserId;
  const canEditRuntime = isAdmin || isRuntimeOwner;
  const isCustomRuntime = !!runtime.profile_id;
  const canDelete = isCustomRuntime ? isAdmin : canEditRuntime;
  return {
    isAdmin,
    isRuntimeOwner,
    canEditRuntime,
    canDelete,
    canEditVisibility: isRuntimeOwner,
  };
}

/** A live local daemon re-registers itself within seconds of a server-side
 *  delete (daemon self-heal, #2404). Mirrors web packages/views/runtimes/utils */
export function isSelfHealingRuntime(runtime: {
  runtime_mode: string;
  status: string;
}): boolean {
  return runtime.runtime_mode === "local" && runtime.status === "online";
}

export interface ActiveAgentsConflict {
  code: "runtime_has_active_agents" | "runtime_delete_plan_changed";
  activeAgents: Array<{ id: string; name: string }>;
}

/**
 * Pulls the structured 409 fields off a fetch error. Duck-typed on the
 * ApiError shape (status 409 + body.code) so this stays header-free. Non-409s,
 * non-active-agents codes, and missing bodies collapse to `null` so callers
 * fall through to the generic error toast.
 */
export function parseActiveAgentsConflict(err: unknown): ActiveAgentsConflict | null {
  if (!err || typeof err !== "object") return null;
  if ((err as { status?: unknown }).status !== 409) return null;
  const body = (err as { body?: unknown }).body;
  if (!body || typeof body !== "object") return null;
  const code = (body as { code?: unknown }).code;
  if (
    code !== "runtime_has_active_agents" &&
    code !== "runtime_delete_plan_changed"
  ) {
    return null;
  }
  const rawAgents = (body as { active_agents?: unknown }).active_agents;
  if (!Array.isArray(rawAgents)) {
    return { code, activeAgents: [] };
  }
  const activeAgents = rawAgents.filter(
    (a): a is { id: string; name: string } =>
      !!a &&
      typeof a === "object" &&
      typeof (a as { id?: unknown }).id === "string" &&
      typeof (a as { name?: unknown }).name === "string",
  );
  return { code, activeAgents };
}