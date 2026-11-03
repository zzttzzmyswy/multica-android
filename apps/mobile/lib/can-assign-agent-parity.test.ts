/**
 * Differential pin: the mobile mirror must answer exactly what web answers
 * (MYS-2550).
 *
 * `lib/can-assign-agent.ts` is a hand-copied mirror of
 * `packages/core/permissions/rules.ts:canAssignAgentToIssue` — mobile may only
 * `import type` from `@multica/core`, so the logic is duplicated on purpose.
 * The cost of duplication is drift, and the previous drift was invisible
 * because nothing compared the two: the mirror read the DERIVED `visibility`
 * field while core read `permission_mode` + `invocation_targets`, so a
 * workspace admin passed on someone else's private agent (the server 403s)
 * and a granted member was refused an agent they may invoke.
 *
 * A per-branch assertion cannot catch that class of bug, because the branches
 * themselves are what went missing. This file instead enumerates the cross
 * product of every input the rule reads and asserts the two implementations
 * agree on all of it — so a future edit to either side that changes an answer
 * fails here, naming the exact record.
 *
 * The table is generated rather than hand-listed for the same reason: a case
 * someone forgot to write down would be a case nobody compares.
 */
import { describe, expect, it } from "vitest";
import { canAssignAgentToIssue } from "@multica/core/permissions";
import type { Agent, AgentPermissionMode, MemberRole } from "@multica/core/types";
import { canAssignAgent } from "./can-assign-agent";

const ME = "user-me";
const OTHER = "user-other";

const ROLES: (MemberRole | null)[] = ["owner", "admin", "member", null];
/** The CLOSED enum both sides' types declare. An out-of-enum value is covered
 *  on its own below, because the two implementations deliberately differ there
 *  — see "an out-of-enum mode". */
const MODES: AgentPermissionMode[] = ["private", "public_to"];
const OWNERS: (string | null)[] = [ME, OTHER, null];
const TARGETS: { label: string; value: Agent["invocation_targets"] }[] = [
  { label: "none", value: [] },
  { label: "workspace", value: [{ target_type: "workspace", target_id: null }] },
  { label: "member:me", value: [{ target_type: "member", target_id: ME }] },
  { label: "member:other", value: [{ target_type: "member", target_id: OTHER }] },
  { label: "team", value: [{ target_type: "team", target_id: ME }] },
];

interface Case {
  mode: string;
  owner: string | null;
  targets: string;
  role: MemberRole | null;
  userId: string | null;
}

function build(c: Case): Agent {
  const targets = TARGETS.find((t) => t.label === c.targets)!.value;
  return {
    id: "agent-1",
    workspace_id: "ws-1",
    archived_at: null,
    owner_id: c.owner,
    permission_mode: c.mode,
    invocation_targets: targets,
  } as Agent;
}

/** Every combination the rule distinguishes — including the shapes a drifted
 *  backend could send (an unknown mode, a null owner). */
const CASES: Case[] = [];
for (const mode of MODES) {
  for (const owner of OWNERS) {
    for (const target of TARGETS) {
      for (const role of ROLES) {
        for (const userId of [ME, null]) {
          CASES.push({ mode, owner, targets: target.label, role, userId });
        }
      }
    }
  }
}

describe("canAssignAgent mirrors canAssignAgentToIssue", () => {
  it("covers the whole input space", () => {
    // 2 modes × 3 owners × 5 target shapes × 4 roles × 2 callers. Asserted so
    // that an input added above without widening the product is a failure
    // rather than a quietly untested dimension.
    expect(CASES).toHaveLength(2 * 3 * 5 * 4 * 2);
  });

  it("agrees on every case", () => {
    const disagreements = CASES.filter((c) => {
      const agent = build(c);
      const web = canAssignAgentToIssue(agent, {
        userId: c.userId,
        role: c.role,
      }).allowed;
      const mobile = canAssignAgent(agent, c.userId, c.role);
      return web !== mobile;
    }).map((c) => `mode=${c.mode} owner=${c.owner} targets=${c.targets} role=${c.role} user=${c.userId}`);

    expect(disagreements).toEqual([]);
  });
});

/**
 * The one place the two implementations intentionally differ, pinned so the
 * difference stays a decision instead of becoming an accident.
 *
 * Both types declare `permission_mode` as the closed union
 * `"private" | "public_to"`, so an out-of-enum value means a backend this
 * build predates (or a drifted payload). The two sides read that case with
 * different fallthroughs:
 *
 *   - core's rule tests `=== "private"` and falls through to the grant walk,
 *     i.e. an unknown mode is treated as `public_to`;
 *   - the server tests `!= "public_to"` and denies
 *     (`server/internal/handler/agent_access.go:canInvokeAgent`).
 *
 * The server is the authority — it is the thing that actually decides whether
 * a run is enqueued — so the phone follows the server and fails closed. That
 * only ever costs an offer the server would have refused; following core here
 * would offer one it accepts and the server then rejects with a 403 the user
 * cannot act on.
 *
 * When core is tightened to match the server, this test fails, and that
 * failure is the prompt to delete the divergence rather than a regression.
 */
describe("an out-of-enum mode (deliberate divergence from core)", () => {
  const drifted = {
    id: "agent-1",
    workspace_id: "ws-1",
    archived_at: null,
    owner_id: OTHER,
    permission_mode: "team_shared",
    invocation_targets: [{ target_type: "workspace", target_id: null }],
  } as unknown as Agent;

  it("core falls through to the grants and allows", () => {
    expect(
      canAssignAgentToIssue(drifted, { userId: ME, role: "member" }).allowed,
    ).toBe(true);
  });

  it("mobile follows the server and denies", () => {
    expect(canAssignAgent(drifted, ME, "member")).toBe(false);
  });
});
