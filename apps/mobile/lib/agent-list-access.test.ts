/**
 * Tests for the agents-list access helpers (iteration-84, A8) — scope badge
 * derivation, the access-filter predicate, and the batch-selection plan that
 * gates archive/restore on ownership + workspace role and bulk-access Apply on
 * `isOwnedByMe` (web agent-batch-toolbar.tsx semantics).
 */
import type { Agent, AgentPermissionMode } from "@multica/core/types";
import { describe, expect, it } from "vitest";
import {
  accessScopeOfAgent,
  buildAgentBatchSelection,
  matchesAccessFilter,
} from "./agent-list-access";

function agent(
  id: string,
  over: {
    permission_mode?: AgentPermissionMode;
    workspace_target?: boolean;
    member_targets?: string[];
    archived?: boolean;
    owner_id?: string | null;
  } = {},
): Agent {
  const invocation_targets: { target_type: "workspace" | "member"; target_id: string | null }[] = [];
  if (over.workspace_target) {
    invocation_targets.push({ target_type: "workspace", target_id: null });
  }
  for (const tid of over.member_targets ?? []) {
    invocation_targets.push({ target_type: "member", target_id: tid });
  }
  return {
    id,
    name: id,
    permission_mode: over.permission_mode ?? "private",
    invocation_targets,
    visibility: "private",
    owner_id: over.owner_id ?? null,
    archived_at: over.archived ? "2026-08-01T00:00:00Z" : null,
    status: over.archived ? "archived" : "active",
    created_at: "",
    updated_at: "",
  } as unknown as Agent;
}

describe("accessScopeOfAgent", () => {
  it("derives workspace for public_to + workspace target", () => {
    expect(
      accessScopeOfAgent(
        agent("a", { permission_mode: "public_to", workspace_target: true }),
      ),
    ).toBe("workspace");
  });

  it("derives specific-people for member-only targets", () => {
    expect(
      accessScopeOfAgent(
        agent("a", { permission_mode: "public_to", member_targets: ["u-1"] }),
      ),
    ).toBe("specific-people");
  });

  it("derives owner-only for private", () => {
    expect(accessScopeOfAgent(agent("a"))).toBe("owner-only");
  });
});

describe("matchesAccessFilter", () => {
  it("empty selection means no filter (everything passes)", () => {
    const ws = agent("a", { permission_mode: "public_to", workspace_target: true });
    const priv = agent("b");
    expect(matchesAccessFilter(ws, new Set())).toBe(true);
    expect(matchesAccessFilter(priv, new Set())).toBe(true);
  });

  it("filters to the selected scopes only", () => {
    const ws = agent("a", { permission_mode: "public_to", workspace_target: true });
    const specific = agent("b", { permission_mode: "public_to", member_targets: ["u-1"] });
    const priv = agent("c");
    const selected = new Set<"workspace" | "specific-people" | "owner-only">(["workspace"]);
    expect(matchesAccessFilter(ws, selected)).toBe(true);
    expect(matchesAccessFilter(specific, selected)).toBe(false);
    expect(matchesAccessFilter(priv, selected)).toBe(false);
  });

  it("supports multi-scope selection", () => {
    const selected = new Set<"workspace" | "specific-people" | "owner-only">([
      "workspace",
      "specific-people",
    ]);
    expect(
      matchesAccessFilter(
        agent("a", { permission_mode: "public_to", workspace_target: true }),
        selected,
      ),
    ).toBe(true);
    expect(
      matchesAccessFilter(
        agent("b", { permission_mode: "public_to", member_targets: ["u-1"] }),
        selected,
      ),
    ).toBe(true);
    expect(matchesAccessFilter(agent("c"), selected)).toBe(false);
  });
});

describe("buildAgentBatchSelection", () => {
  const me = "u-me";
  const other = "u-other";
  const sel = (ids: string[]) => new Set(ids);

  it("partitions archived vs active rows by archived_at", () => {
    const plan = buildAgentBatchSelection({
      agents: [agent("arch", { archived: true }), agent("act")],
      selectedIds: sel(["arch", "act"]),
      currentUserId: me,
      currentRole: "owner",
    });
    expect(plan.archivedIds).toEqual(["arch"]);
    expect(plan.activeIds).toEqual(["act"]);
  });

  it("tracks own rows and counts skipped rows for bulk access", () => {
    const plan = buildAgentBatchSelection({
      agents: [
        agent("mine", { owner_id: me }),
        agent("theirs", { owner_id: other }),
        agent("unowned", { owner_id: null }),
      ],
      selectedIds: sel(["mine", "theirs", "unowned"]),
      currentUserId: me,
      currentRole: "owner",
    });
    expect(plan.ownedIds).toEqual(["mine"]);
    expect(plan.accessSkipCount).toBe(2);
  });

  it("an owner/admin workspace role makes unowned rows manageable for archive", () => {
    const plan = buildAgentBatchSelection({
      agents: [agent("theirs", { owner_id: other })],
      selectedIds: sel(["theirs"]),
      currentUserId: me,
      currentRole: "admin",
    });
    expect(plan.manageableIds).toContain("theirs");
    // ...but bulk access stays owner-only — admins may archive, not rewrite grants.
    expect(plan.ownedIds).toEqual([]);
    expect(plan.accessSkipCount).toBe(1);
  });

  it("a plain member can archive only their own agents", () => {
    const plan = buildAgentBatchSelection({
      agents: [agent("mine", { owner_id: me }), agent("theirs", { owner_id: other })],
      selectedIds: sel(["mine", "theirs"]),
      currentUserId: me,
      currentRole: "member",
    });
    expect(plan.manageableIds).toEqual(["mine"]);
    expect(plan.archivableIds).toEqual(["mine"]);
  });

  it("an agent owner who is a plain member still manages (canManage = owner OR admin)", () => {
    const plan = buildAgentBatchSelection({
      agents: [agent("mine", { owner_id: me }), agent("theirs", { owner_id: other })],
      selectedIds: sel(["mine"]),
      currentUserId: me,
      currentRole: "member",
    });
    expect(plan.manageableIds).toEqual(["mine"]);
    expect(plan.archivableIds).toEqual(["mine"]);
    expect(plan.ownedIds).toEqual(["mine"]);
  });

  it("ignores rows outside the selection", () => {
    const plan = buildAgentBatchSelection({
      agents: [agent("a"), agent("b"), agent("c")],
      selectedIds: sel(["a", "c"]),
      currentUserId: me,
      currentRole: "owner",
    });
    expect(plan.selection.map((s) => s.id)).toEqual(["a", "c"]);
  });
});