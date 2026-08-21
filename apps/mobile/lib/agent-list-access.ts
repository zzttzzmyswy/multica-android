/**
 * Pure helpers for the agents list access surface (iteration-84, A8) — web
 * `agents-page.tsx` + `agent-batch-toolbar.tsx` semantics:
 *
 *  - `accessScopeOfAgent` — the three-state scope badge shown on each row
 *    (workspace / specific-people / owner-only), derived from the
 *    authoritative `permission_mode` + `invocation_targets` (MUL-3963).
 *  - `matchesAccessFilter` — the list's access filter predicate (empty
 *    selection = inactive).
 *  - `buildAgentBatchSelection` — the batch toolbar's plan: archive/restore
 *    need `canManage` (owner OR workspace admin), bulk-access Apply is
 *    owner-only (`isOwnedByMe`); non-owned rows are skipped and counted.
 */
import type { Agent, MemberRole } from "@multica/core/types";
import { canManageRole } from "@/lib/member-guards";
import { effectiveAccessScope, type AccessScope } from "@/lib/agent-access";

type AccessFlagAgent = Pick<Agent, "permission_mode" | "invocation_targets">;

/** Effective three-state scope for a row badge / filter. */
export function accessScopeOfAgent(agent: AccessFlagAgent): AccessScope {
  return effectiveAccessScope(agent.permission_mode, agent.invocation_targets);
}

/** Access filter predicate: an empty selection is inactive (passes all). */
export function matchesAccessFilter(
  agent: AccessFlagAgent,
  selectedScopes: ReadonlySet<AccessScope>,
): boolean {
  if (selectedScopes.size === 0) return true;
  return selectedScopes.has(accessScopeOfAgent(agent));
}

export interface AgentBatchSelection {
  /** Selected rows expanded with the flags the toolbar actions need. */
  selection: {
    id: string;
    archived: boolean;
    ownedByMe: boolean;
    canManage: boolean;
  }[];
  /** Archived-at-set selected rows (restore targets). */
  archivedIds: string[];
  /** Live selected rows (bulk-access / archive eligibility). */
  activeIds: string[];
  /** Owner-only rows — the bulk-access Apply set. */
  ownedIds: string[];
  /** canManage rows (owner OR workspace admin) — restore targets. */
  manageableIds: string[];
  /** Selected live rows the current user may archive. */
  archivableIds: string[];
  /** Selected minus owned — rows bulk access must skip (web skip-count). */
  accessSkipCount: number;
}

export function buildAgentBatchSelection({
  agents,
  selectedIds,
  currentUserId,
  currentRole,
}: {
  agents: (Pick<Agent, "id" | "owner_id" | "archived_at" | "status">)[];
  selectedIds: ReadonlySet<string>;
  currentUserId: string | null;
  currentRole: MemberRole | null | undefined;
}): AgentBatchSelection {
  const isManager = canManageRole(currentRole);
  const selection: AgentBatchSelection["selection"] = [];
  const archivedIds: string[] = [];
  const activeIds: string[] = [];
  const ownedIds: string[] = [];
  const manageableIds: string[] = [];
  const archivableIds: string[] = [];

  for (const agent of agents) {
    if (!selectedIds.has(agent.id)) continue;
    const archived =
      Boolean(agent.archived_at) || String(agent.status) === "archived";
    const ownedByMe =
      currentUserId != null && agent.owner_id === currentUserId;
    const canManage = ownedByMe || isManager;
    selection.push({ id: agent.id, archived, ownedByMe, canManage });
    if (archived) archivedIds.push(agent.id);
    else {
      activeIds.push(agent.id);
      if (canManage) archivableIds.push(agent.id);
    }
    if (ownedByMe) ownedIds.push(agent.id);
    if (canManage) manageableIds.push(agent.id);
  }

  return {
    selection,
    archivedIds,
    activeIds,
    ownedIds,
    manageableIds,
    archivableIds,
    accessSkipCount: selection.length - ownedIds.length,
  };
}