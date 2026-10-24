/**
 * Runtime access scope — the phone mirror of web
 * `packages/views/runtimes/components/runtime-access-editor.tsx` (MUL-8185).
 *
 * Web models access as three scopes over two stored fields: `visibility` says
 * whether the machine is open to the workspace, and `shared_with` names the
 * members who may use it while it stays private. Mobile shipped only the two
 * enum values, so a shared runtime rendered as plain "Private" — the granted
 * member saw a lock on a machine they were allowed to use, and the owner had
 * no way to grant anyone. The three-way vocabulary is therefore derived here,
 * once, rather than re-inferred at each surface.
 *
 * Kept React-free so the Node vitest lane can pin the parts a markup guard
 * cannot see: which scope a row reports, what a PATCH body must contain, and —
 * the part that fails silently — whether an unreadable 409 plan is allowed to
 * look like "nothing is affected".
 */
import type { AgentRuntime, MemberWithUser } from "@multica/core/types";

/**
 * The access choices the UI offers. `members` is not a stored value: it is
 * "private, but with a non-empty grant list", which is why both the editor and
 * the row badge derive it instead of reading it off the wire.
 */
export type RuntimeAccessScope = "private" | "public" | "members";

/**
 * Which of the three scopes a runtime is currently in.
 *
 * Order matters: `public` wins over any leftover grants, because the server
 * rejects a public runtime that still carries a grant list and always clears it
 * when visibility flips to public. Grants that survive a stale read therefore
 * describe a machine that is open to everyone, not one shared with a few.
 */
export function runtimeAccessScope(
  runtime: Pick<AgentRuntime, "visibility" | "shared_with">,
): RuntimeAccessScope {
  if (runtime.visibility === "public") return "public";
  return (runtime.shared_with?.length ?? 0) > 0 ? "members" : "private";
}

/**
 * The member rows named by `shared_with`, in the order the server stored them.
 *
 * The server sorts the list and only lets workspace members in, so this is a
 * lookup, not a filter: an id with no matching member means the member left the
 * workspace after being granted. Those ids are preserved in the count but have
 * no row to render, exactly as web's `recipients` does — dropping them would
 * make the shown avatars disagree with the "N members" total.
 */
export function sharedWithMembers(
  runtime: Pick<AgentRuntime, "shared_with">,
  members: readonly MemberWithUser[],
): MemberWithUser[] {
  const ids = runtime.shared_with ?? [];
  if (ids.length === 0) return [];
  const byId = new Map(members.map((member) => [member.user_id, member]));
  return ids
    .map((id) => byId.get(id))
    .filter((member): member is MemberWithUser => !!member);
}

/**
 * Members the grant picker may offer: everyone in the workspace except the
 * runtime owner. The owner always has access, so listing them as a checkbox
 * would imply their access can be switched off. Mirrors web's
 * `members.filter((member) => member.user_id !== runtime.owner_id)`.
 */
export function shareableMembers(
  runtime: Pick<AgentRuntime, "owner_id">,
  members: readonly MemberWithUser[],
): MemberWithUser[] {
  return members.filter((member) => member.user_id !== runtime.owner_id);
}

/** Case-insensitive name/email search over the grant picker's candidates. */
export function filterShareableMembers(
  candidates: readonly MemberWithUser[],
  query: string,
): MemberWithUser[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...candidates];
  return candidates.filter(
    (member) =>
      member.name.toLowerCase().includes(needle) ||
      member.email.toLowerCase().includes(needle),
  );
}

/**
 * Whether the draft selection differs from what the server currently holds.
 * Order-insensitive: the server stores the list sorted, so a reorder is not an
 * edit and must not enable Save.
 */
export function isShareDraftDirty(
  persisted: readonly string[],
  draft: readonly string[],
): boolean {
  if (draft.length !== persisted.length) return true;
  return draft.some((id) => !persisted.includes(id));
}

/**
 * Whether Save is allowed: something actually changed, a non-empty selection
 * was made, and no write is already in flight.
 *
 * The non-empty rule is web's (`disabled={saving || !dirty || selected.length
 * === 0}`): emptying the list is "private", which has its own one-click
 * button. Allowing Save with zero members would apply a `members` scope the
 * server would then report as plain private — a silent scope change.
 */
export function canSaveShareDraft(
  persisted: readonly string[],
  draft: readonly string[],
  saving: boolean,
): boolean {
  if (saving) return false;
  if (draft.length === 0) return false;
  return isShareDraftDirty(persisted, draft);
}

/**
 * The PATCH body for a scope choice.
 *
 * `shared_with` is always sent, including as an empty array: the server treats
 * an explicit `visibility` with no grant list as "clear the grants", which is
 * how Private and Public revoke sharing in one click. Sending grants alongside
 * `visibility: "public"` is a 400 (`shared_with requires private visibility`),
 * so the two are kept consistent here rather than at each call site.
 */
export function runtimeAccessPatch(
  scope: RuntimeAccessScope,
  memberIds: readonly string[] = [],
): { visibility: "private" | "public"; shared_with: string[] } {
  if (scope === "public") return { visibility: "public", shared_with: [] };
  if (scope === "private") return { visibility: "private", shared_with: [] };
  // Deduplicate defensively: a double-tap on a checkbox row must not submit
  // the same member twice, which the server would store as one grant anyway
  // but which would make the local count disagree with the server's.
  return { visibility: "private", shared_with: [...new Set(memberIds)] };
}

/** A restriction the server refuses to apply until its impact is confirmed. */
export interface RuntimeAccessRevocationPlan {
  agents: Array<{ id: string; name: string }>;
  activeTaskIds: string[];
}

/** The two 409 bodies that carry a revocable plan (same shape, different cause). */
const REVOCATION_PLAN_CODES = new Set([
  "runtime_has_nonowner_dependents",
  "runtime_access_revocation_plan_changed",
]);

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Pulls the restriction plan out of a structured 409.
 *
 * Duck-typed on the ApiError shape (status 409 + `body.code`) so this stays
 * header-free, like `parseActiveAgentsConflict` next door.
 *
 * Everything that is not a complete, self-consistent plan returns `null`, and
 * `null` means "this was not a reviewable plan" — the caller falls through to a
 * generic failure and, critically, does **not** submit a revocation. Web's
 * schema is explicitly fail-closed for the same reason: a destructive
 * confirmation built from a half-read plan would unbind whatever agents the
 * defaulted-empty arrays happened to name. That is why a missing or malformed
 * `nonowner_agents` / `active_task_ids` is rejected here instead of being
 * defaulted to `[]`.
 */
export function parseRuntimeAccessRevocationPlan(
  err: unknown,
): RuntimeAccessRevocationPlan | null {
  if (!err || typeof err !== "object") return null;
  if ((err as { status?: unknown }).status !== 409) return null;
  const body = (err as { body?: unknown }).body;
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (typeof record.code !== "string" || !REVOCATION_PLAN_CODES.has(record.code)) {
    return null;
  }

  const rawAgents = record.nonowner_agents;
  const rawTaskIds = record.active_task_ids;
  if (!Array.isArray(rawAgents) || !isStringArray(rawTaskIds)) return null;

  const agents: Array<{ id: string; name: string }> = [];
  for (const entry of rawAgents) {
    if (!entry || typeof entry !== "object") return null;
    const agent = entry as { id?: unknown; name?: unknown };
    if (typeof agent.id !== "string" || typeof agent.name !== "string") return null;
    agents.push({ id: agent.id, name: agent.name });
  }

  // The confirmed request re-checks these exact sets server-side, so a
  // duplicated id would make the plan un-submittable and the runtime
  // un-restrictable. Web's schema refines the same two uniqueness rules.
  if (new Set(agents.map((agent) => agent.id)).size !== agents.length) return null;
  if (new Set(rawTaskIds).size !== rawTaskIds.length) return null;

  return { agents, activeTaskIds: rawTaskIds };
}

/**
 * Who the restriction affects, in the words the confirmation needs.
 *
 * `agents` is the authoritative list; `taskCount` is reported separately
 * because a run can be cancelled without its agent being unbound. Both are
 * printed from the plan itself, never re-derived from local caches — the point
 * of the confirmation is that the server told us what it is about to do.
 */
export function describeRevocationPlan(plan: RuntimeAccessRevocationPlan): {
  agentCount: number;
  taskCount: number;
} {
  return { agentCount: plan.agents.length, taskCount: plan.activeTaskIds.length };
}

/**
 * Whether a runtime's access scope renders a badge on the browse list.
 *
 * Private-and-unshared is the default, so badging it would put a lock on
 * nearly every row and turn the column into noise (web's `VisibilityBadge`
 * returns null there). The three scopes that do earn a badge are Public and
 * Specific-members; the third "no badge" case is folded into this predicate so
 * the row component never re-decides it.
 */
export function runtimeAccessBadge(
  runtime: Pick<AgentRuntime, "visibility" | "shared_with">,
): "public" | "members" | null {
  const scope = runtimeAccessScope(runtime);
  return scope === "private" ? null : scope;
}
