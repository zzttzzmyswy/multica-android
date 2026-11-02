/**
 * Pins the mobile mirror of the agent-invocation permission rule
 * (MYS-2550).
 *
 * The rule decides four things on the phone — "chat with this agent", "assign
 * work", which rows the chat picker offers, and whether the chat tab claims the
 * workspace has no usable agent — so a wrong answer here is not cosmetic: the
 * same person gets a different set of possible actions depending on which
 * client they open.
 *
 * The defect: this file read the DERIVED `agent.visibility` field, while both
 * web (`packages/core/permissions/rules.ts:canAssignAgentToIssue`) and the
 * server (`server/internal/handler/agent_access.go:canInvokeAgent`) judge on
 * the AUTHORITATIVE `permission_mode` + `invocation_targets` (MUL-3963).
 * `visibility` is a lossy two-state projection of those two fields — a
 * `public_to` agent whose only grant is a single member still projects to
 * `visibility: "private"` — so the phone was wrong in BOTH directions:
 *
 *   - a workspace admin passed on someone else's `private` agent (old model:
 *     admins bypass), and the server answers 403 — no admin bypass exists;
 *   - a member named in the grant list was refused a `public_to` agent they
 *     are explicitly allowed to invoke.
 *
 * Every case below is asserted against the exact decision web makes for the
 * same record, so web and mobile cannot drift apart silently again.
 */
import { describe, expect, it } from "vitest";
import type { Agent } from "@multica/core/types";
import { canAssignAgent } from "./can-assign-agent";

const ME = "user-me";
const SOMEONE_ELSE = "user-someone-else";
const WS_TARGET = { target_type: "workspace" as const, target_id: null };
const myGrant = { target_type: "member" as const, target_id: ME };
const otherGrant = {
  target_type: "member" as const,
  target_id: SOMEONE_ELSE,
};

/**
 * An agent record as the server actually serialises it: `visibility` is
 * DERIVED from `permission_mode` + targets by
 * `server/internal/handler/agent_permission.go:deriveLegacyVisibility`, so the
 * fixtures derive it too instead of letting a hand-written pair contradict
 * itself.
 */
function agent(overrides: Partial<Agent> = {}): Agent {
  const permissionMode = overrides.permission_mode ?? "private";
  const targets = overrides.invocation_targets ?? [];
  const derived =
    permissionMode === "public_to" &&
    targets.some((t) => t.target_type === "workspace")
      ? "workspace"
      : "private";
  return {
    id: "agent-1",
    workspace_id: "ws-1",
    archived_at: null,
    owner_id: SOMEONE_ELSE,
    permission_mode: permissionMode,
    invocation_targets: targets,
    ...overrides,
    // Derived last so an override cannot smuggle in a pair the server would
    // never emit — an explicit `visibility` override is the one exception the
    // "the derived field never decides" case needs, so it is honoured when
    // given, otherwise the pair decides.
    visibility: overrides.visibility ?? derived,
  } as Agent;
}

describe("canAssignAgent — the owner", () => {
  it("may invoke their own agent whatever the mode", () => {
    expect(
      canAssignAgent(agent({ owner_id: ME, permission_mode: "private" }), ME, "member"),
    ).toBe(true);
    expect(
      canAssignAgent(
        agent({ owner_id: ME, permission_mode: "public_to", invocation_targets: [] }),
        ME,
        "member",
      ),
    ).toBe(true);
  });

  it("needs a signed-in user at all", () => {
    expect(canAssignAgent(agent({ owner_id: ME }), null, "owner")).toBe(false);
    expect(canAssignAgent(agent({ owner_id: ME }), undefined, "owner")).toBe(false);
  });
});

describe("canAssignAgent — private mode", () => {
  it("refuses a workspace ADMIN who is not the owner", () => {
    // The behaviour change vs the old visibility model, and the direction the
    // phone used to get wrong: `visibility === "private"` + admin role used to
    // return true here, so the button was offered for a call the server
    // refuses with 403 ("cannot assign to private agent").
    expect(
      canAssignAgent(agent({ owner_id: SOMEONE_ELSE, permission_mode: "private" }), ME, "admin"),
    ).toBe(false);
    expect(
      canAssignAgent(agent({ owner_id: SOMEONE_ELSE, permission_mode: "private" }), ME, "owner"),
    ).toBe(false);
  });

  it("refuses a plain member", () => {
    expect(
      canAssignAgent(agent({ owner_id: SOMEONE_ELSE, permission_mode: "private" }), ME, "member"),
    ).toBe(false);
  });

  it("treats an unknown mode as private, which is the deny side", () => {
    // A backend this build predates, a drifted enum value: both read as "not
    // granted" rather than "open to the workspace".
    expect(
      canAssignAgent(
        agent({
          owner_id: SOMEONE_ELSE,
          permission_mode: "something_new" as Agent["permission_mode"],
          visibility: "workspace",
        }),
        ME,
        "admin",
      ),
    ).toBe(false);
  });
});

describe("canAssignAgent — public_to with a workspace grant", () => {
  it("admits any workspace member", () => {
    for (const role of ["owner", "admin", "member"] as const) {
      expect(
        canAssignAgent(
          agent({ permission_mode: "public_to", invocation_targets: [WS_TARGET] }),
          ME,
          role,
        ),
      ).toBe(true);
    }
  });

  it("refuses a caller who is not a member of this workspace", () => {
    // `role: null` models "not a member / membership still loading". The
    // server's workspace-target branch admits workspace-internal principals
    // only, so a non-member has no path through it.
    expect(
      canAssignAgent(
        agent({ permission_mode: "public_to", invocation_targets: [WS_TARGET] }),
        ME,
        null,
      ),
    ).toBe(false);
  });

  it("refuses a role string outside the three this app knows", () => {
    // A newer backend's role (or an empty string from a legacy one) must not
    // read as membership. Testing only `null` leaves this hole open: a
    // helper that forwards the raw string would admit `""` here, because the
    // workspace branch asks "is the role non-null", not "is it one of ours".
    // core's rule narrows to owner/admin/member the same way.
    for (const role of ["guest", "", "Owner", "admin "] as const) {
      expect(
        canAssignAgent(
          agent({ permission_mode: "public_to", invocation_targets: [WS_TARGET] }),
          ME,
          role as never,
        ),
      ).toBe(false);
    }
  });
});

describe("canAssignAgent — public_to scoped to named members", () => {
  it("admits the granted member", () => {
    // The direction the phone used to get wrong: this record derives
    // `visibility: "private"`, so the old rule refused a member the server
    // explicitly allows.
    const scoped = agent({ permission_mode: "public_to", invocation_targets: [myGrant] });
    expect(scoped.visibility).toBe("private");
    expect(canAssignAgent(scoped, ME, "member")).toBe(true);
  });

  it("refuses a member who was not named", () => {
    expect(
      canAssignAgent(
        agent({ permission_mode: "public_to", invocation_targets: [otherGrant] }),
        ME,
        "admin",
      ),
    ).toBe(false);
  });

  it("keeps team targets inert, so a team grant alone admits nobody", () => {
    // Reserved in v1 and never grants (MUL-3963). Folding it in would open an
    // agent the server still refuses.
    expect(
      canAssignAgent(
        agent({
          permission_mode: "public_to",
          invocation_targets: [{ target_type: "team", target_id: ME }],
        }),
        ME,
        "admin",
      ),
    ).toBe(false);
  });

  it("refuses when public_to carries no targets at all", () => {
    expect(
      canAssignAgent(
        agent({ permission_mode: "public_to", invocation_targets: [] }),
        ME,
        "member",
      ),
    ).toBe(false);
  });
});

describe("canAssignAgent — the derived field never decides", () => {
  it("ignores a visibility that disagrees with the authoritative fields", () => {
    // A stale cache row, or a backend that only half-updated the pair. The
    // authoritative fields are the ones the server enforces, so they win in
    // both directions.
    const disabledButWorkspace = agent({
      permission_mode: "private",
      invocation_targets: [],
      visibility: "workspace",
    });
    expect(canAssignAgent(disabledButWorkspace, ME, "admin")).toBe(false);

    const grantedButPrivate = agent({
      permission_mode: "public_to",
      invocation_targets: [WS_TARGET],
      visibility: "private",
    });
    expect(canAssignAgent(grantedButPrivate, ME, "member")).toBe(true);
  });
});
