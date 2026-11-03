/**
 * Pins the assignee picker's row gate (MYS-2550).
 *
 * The defect: the picker consulted only the runtime gate, so an agent the
 * caller may not invoke rendered as pickable and the refusal arrived as a
 * server 403 after the write. Web greys the row and names the reason.
 *
 * These cases follow web's `assignee-picker.tsx` row logic line by line —
 * including the two places it DOESN'T gate, which are just as load-bearing as
 * the place it does: a helper that also refused squads-with-private-leaders
 * would hide rows web offers, drifting in the opposite direction.
 */
import { describe, expect, it } from "vitest";
import type { Agent, MemberRole } from "@multica/core/types";
import { assigneeRowBlock } from "./assignee-row-gate";

const ME = "user-me";
const OTHER = "user-other";

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    workspace_id: "ws-1",
    archived_at: null,
    owner_id: OTHER,
    permission_mode: "public_to",
    invocation_targets: [{ target_type: "workspace", target_id: null }],
    ...overrides,
  } as Agent;
}

const ROLE: MemberRole = "member";

describe("assigneeRowBlock — rows with no invoke gate", () => {
  it("never blocks unassigned or member rows", () => {
    for (const kind of ["unassigned", "member"] as const) {
      expect(assigneeRowBlock({ kind, userId: ME, role: ROLE })).toBeNull();
      // …not even for a caller whose membership has not resolved: clearing an
      // assignee and picking a person are not agent invocations.
      expect(assigneeRowBlock({ kind, userId: null, role: null })).toBeNull();
    }
  });
});

describe("assigneeRowBlock — agent rows", () => {
  it("blocks a private agent the caller does not own, naming PERMISSION", () => {
    expect(
      assigneeRowBlock({
        kind: "agent",
        agent: agent({ permission_mode: "private", invocation_targets: [] }),
        userId: ME,
        role: ROLE,
      }),
    ).toBe("permission");
  });

  it("blocks an admin on someone else's private agent too", () => {
    // No admin bypass exists on the server, so offering the row would only
    // produce a 403 after the write.
    expect(
      assigneeRowBlock({
        kind: "agent",
        agent: agent({ permission_mode: "private", invocation_targets: [] }),
        userId: ME,
        role: "admin",
      }),
    ).toBe("permission");
  });

  it("lets a granted member through", () => {
    expect(
      assigneeRowBlock({
        kind: "agent",
        agent: agent({
          permission_mode: "public_to",
          invocation_targets: [{ target_type: "member", target_id: ME }],
        }),
        userId: ME,
        role: ROLE,
      }),
    ).toBeNull();
  });

  it("reports PERMISSION before RUNTIME when both fail", () => {
    // Web's tooltip precedence: the permission sentence is the one the reader
    // can act on, and binding a runtime would not make the row assignable.
    expect(
      assigneeRowBlock({
        kind: "agent",
        agent: agent({ permission_mode: "private", invocation_targets: [] }),
        runtimeBound: false,
        userId: ME,
        role: ROLE,
      }),
    ).toBe("permission");
  });

  it("reports RUNTIME for an invokable agent with no bound runtime", () => {
    expect(
      assigneeRowBlock({
        kind: "agent",
        agent: agent(),
        runtimeBound: false,
        userId: ME,
        role: ROLE,
      }),
    ).toBe("runtime");
  });

  it("blocks every agent row while the caller is unknown", () => {
    // `userId === null` means "auth has not resolved". The server denies an
    // unattributed caller, so the row must not look pickable.
    expect(
      assigneeRowBlock({ kind: "agent", agent: agent(), userId: null, role: ROLE }),
    ).toBe("permission");
  });
});

describe("assigneeRowBlock — squad rows", () => {
  it("blocks a squad whose leader has no runtime", () => {
    expect(
      assigneeRowBlock({ kind: "squad", runtimeBound: false, userId: ME, role: ROLE }),
    ).toBe("runtime");
  });

  it("does NOT add a permission gate web does not have", () => {
    // Web's squad row checks `runnableAgentIds.has(s.leader_id)` only. Adding a
    // leader-permission check here would hide rows web offers.
    expect(
      assigneeRowBlock({ kind: "squad", runtimeBound: true, userId: ME, role: ROLE }),
    ).toBeNull();
    expect(
      assigneeRowBlock({ kind: "squad", runtimeBound: true, userId: null, role: null }),
    ).toBeNull();
  });
});
