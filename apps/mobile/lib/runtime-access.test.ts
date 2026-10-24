/**
 * Runtime access scope (MUL-8185) — pins the three-way scope derivation, the
 * PATCH body each choice must submit, and the fail-closed 409 plan parser.
 *
 * The shipped defect this covers: mobile knew only `visibility`, so a runtime
 * shared with specific members rendered as plain "Private". A granted member
 * was shown a locked row on a machine the server lets them use, and the owner
 * had no way to grant anyone from the phone.
 */
import { describe, expect, it } from "vitest";
import type { MemberWithUser } from "@multica/core/types";
import { isRuntimeUsableForUser } from "@multica/core/runtimes";
import {
  canSaveShareDraft,
  describeRevocationPlan,
  filterShareableMembers,
  isShareDraftDirty,
  parseRuntimeAccessRevocationPlan,
  runtimeAccessBadge,
  runtimeAccessPatch,
  runtimeAccessScope,
  shareableMembers,
  sharedWithMembers,
} from "./runtime-access";

const OWNER = "11111111-1111-4111-8111-111111111111";
const ALICE = "22222222-2222-4222-8222-222222222222";
const BOB = "33333333-3333-4333-8333-333333333333";

function member(user_id: string, name: string, email = `${name}@example.com`): MemberWithUser {
  return {
    id: `m-${user_id}`,
    workspace_id: "ws",
    user_id,
    role: "member",
    created_at: "2026-10-23T00:00:00Z",
    name,
    email,
    avatar_url: null,
  };
}

const MEMBERS = [member(OWNER, "Owner"), member(ALICE, "Alice"), member(BOB, "Bob")];

describe("runtimeAccessScope", () => {
  it("calls a public runtime public even when stale grants survive", () => {
    // The server always clears grants when visibility flips to public, and
    // rejects a public runtime that still carries some. A read that predates
    // that write must not make an open machine look narrowly shared.
    expect(runtimeAccessScope({ visibility: "public", shared_with: [ALICE] })).toBe("public");
  });

  it("calls a private runtime with grants 'members'", () => {
    expect(runtimeAccessScope({ visibility: "private", shared_with: [ALICE] })).toBe("members");
  });

  it("calls a private runtime with no grants private", () => {
    expect(runtimeAccessScope({ visibility: "private", shared_with: [] })).toBe("private");
  });

  it("treats a backend that predates shared_with as private, not as members", () => {
    // A missing field must degrade to the strictest scope. Reading it as
    // "everyone" or as "shared" would both claim a grant nobody made.
    expect(runtimeAccessScope({ visibility: "private" })).toBe("private");
  });
});

describe("sharedWithMembers", () => {
  it("resolves granted ids to member rows in server order", () => {
    const rows = sharedWithMembers({ shared_with: [BOB, ALICE] }, MEMBERS);
    expect(rows.map((row) => row.name)).toEqual(["Bob", "Alice"]);
  });

  it("skips ids whose member left the workspace without shrinking the count source", () => {
    // A grant can outlive the membership briefly. The row list drops the
    // unresolvable id (nothing to render) while the raw list keeps it, which
    // is what web's recipient filter does too.
    const rows = sharedWithMembers({ shared_with: [ALICE, "gone"] }, MEMBERS);
    expect(rows.map((row) => row.name)).toEqual(["Alice"]);
  });

  it("returns nothing for an unshared runtime", () => {
    expect(sharedWithMembers({}, MEMBERS)).toEqual([]);
  });
});

describe("shareableMembers / filterShareableMembers", () => {
  it("never offers the owner: their access is not revocable", () => {
    const candidates = shareableMembers({ owner_id: OWNER }, MEMBERS);
    expect(candidates.map((row) => row.user_id)).toEqual([ALICE, BOB]);
  });

  it("searches name and email case-insensitively", () => {
    const candidates = shareableMembers({ owner_id: OWNER }, MEMBERS);
    expect(filterShareableMembers(candidates, "ali").map((r) => r.name)).toEqual(["Alice"]);
    expect(filterShareableMembers(candidates, "BOB@").map((r) => r.name)).toEqual(["Bob"]);
  });

  it("returns every candidate for an empty query", () => {
    const candidates = shareableMembers({ owner_id: OWNER }, MEMBERS);
    expect(filterShareableMembers(candidates, "   ")).toHaveLength(2);
  });
});

describe("isShareDraftDirty / canSaveShareDraft", () => {
  it("is order-insensitive, because the server stores the list sorted", () => {
    expect(isShareDraftDirty([ALICE, BOB], [BOB, ALICE])).toBe(false);
  });

  it("is dirty when a member is added or dropped", () => {
    expect(isShareDraftDirty([ALICE], [ALICE, BOB])).toBe(true);
    expect(isShareDraftDirty([ALICE, BOB], [ALICE])).toBe(true);
  });

  it("refuses Save while a write is in flight", () => {
    expect(canSaveShareDraft([ALICE], [ALICE, BOB], true)).toBe(false);
  });

  it("refuses Save when nothing changed", () => {
    expect(canSaveShareDraft([ALICE], [ALICE], false)).toBe(false);
  });

  it("refuses Save on an empty selection: that is the Private button, not this one", () => {
    // Saving zero members would submit a `members` scope the server stores as
    // plain private — the user asked for one thing and got another.
    expect(canSaveShareDraft([ALICE], [], false)).toBe(false);
  });

  it("allows Save on a real change", () => {
    expect(canSaveShareDraft([ALICE], [ALICE, BOB], false)).toBe(true);
  });
});

describe("runtimeAccessPatch", () => {
  it("sends an explicit empty grant list for Public", () => {
    // The server reads an explicit visibility with no grants as "clear them",
    // which is how Public and Private revoke sharing in one click.
    expect(runtimeAccessPatch("public")).toEqual({ visibility: "public", shared_with: [] });
  });

  it("sends an explicit empty grant list for Private", () => {
    expect(runtimeAccessPatch("private")).toEqual({ visibility: "private", shared_with: [] });
  });

  it("keeps visibility private when sharing with members", () => {
    // A non-empty list alongside "public" is a 400 on the server.
    expect(runtimeAccessPatch("members", [ALICE, BOB])).toEqual({
      visibility: "private",
      shared_with: [ALICE, BOB],
    });
  });

  it("deduplicates ids so a double tap cannot desync the local count", () => {
    expect(runtimeAccessPatch("members", [ALICE, ALICE])).toEqual({
      visibility: "private",
      shared_with: [ALICE],
    });
  });
});

describe("parseRuntimeAccessRevocationPlan", () => {
  const plan = {
    code: "runtime_has_nonowner_dependents",
    nonowner_agents: [{ id: ALICE, name: "Alice's agent" }],
    active_task_ids: [BOB],
  };

  it("reads a complete plan", () => {
    expect(parseRuntimeAccessRevocationPlan({ status: 409, body: plan })).toEqual({
      agents: [{ id: ALICE, name: "Alice's agent" }],
      activeTaskIds: [BOB],
    });
  });

  it("reads the stale-plan variant of the same shape", () => {
    const stale = { ...plan, code: "runtime_access_revocation_plan_changed" };
    expect(parseRuntimeAccessRevocationPlan({ status: 409, body: stale })).not.toBeNull();
  });

  it("refuses a plan with a missing agent list instead of reading it as zero", () => {
    // Defaulting to [] here would let the confirmation dialog claim "0 agents
    // affected" and then submit a revocation the user never reviewed.
    const { nonowner_agents: _omitted, ...withoutAgents } = plan;
    expect(parseRuntimeAccessRevocationPlan({ status: 409, body: withoutAgents })).toBeNull();
  });

  it("refuses a plan with a missing task list", () => {
    const { active_task_ids: _omitted, ...withoutTasks } = plan;
    expect(parseRuntimeAccessRevocationPlan({ status: 409, body: withoutTasks })).toBeNull();
  });

  it("refuses a malformed agent entry rather than dropping it", () => {
    const body = { ...plan, nonowner_agents: [{ id: ALICE }] };
    expect(parseRuntimeAccessRevocationPlan({ status: 409, body })).toBeNull();
  });

  it("refuses a plan containing duplicate ids, which the server would reject anyway", () => {
    const body = {
      ...plan,
      nonowner_agents: [
        { id: ALICE, name: "a" },
        { id: ALICE, name: "b" },
      ],
    };
    expect(parseRuntimeAccessRevocationPlan({ status: 409, body })).toBeNull();
  });

  it("ignores non-409s and unrelated 409 codes", () => {
    expect(parseRuntimeAccessRevocationPlan({ status: 500, body: plan })).toBeNull();
    expect(
      parseRuntimeAccessRevocationPlan({
        status: 409,
        body: { ...plan, code: "runtime_has_active_agents" },
      }),
    ).toBeNull();
  });

  it("tolerates a plain Error with no body", () => {
    expect(parseRuntimeAccessRevocationPlan(new Error("boom"))).toBeNull();
    expect(parseRuntimeAccessRevocationPlan(null)).toBeNull();
  });
});

describe("describeRevocationPlan", () => {
  it("reports both counts from the plan itself", () => {
    expect(
      describeRevocationPlan({
        agents: [{ id: ALICE, name: "a" }, { id: BOB, name: "b" }],
        activeTaskIds: [ALICE],
      }),
    ).toEqual({ agentCount: 2, taskCount: 1 });
  });
});

describe("runtimeAccessBadge", () => {
  it("badges public and members, and leaves the default private row bare", () => {
    expect(runtimeAccessBadge({ visibility: "public", shared_with: [] })).toBe("public");
    expect(runtimeAccessBadge({ visibility: "private", shared_with: [ALICE] })).toBe("members");
    expect(runtimeAccessBadge({ visibility: "private", shared_with: [] })).toBeNull();
  });
});

describe("access predicate now honours grants (core parity with RuntimeAllowsUser)", () => {
  // `isRuntimeUsableForUser` takes a whole RuntimeDevice, so the cases below
  // spell out only the fields the predicate reads and fill the rest from one
  // base — a partial literal would typecheck only by accident of a stale cast.
  const base = {
    id: "rt-1",
    workspace_id: "ws",
    daemon_id: null,
    name: "Machine",
    runtime_mode: "local" as const,
    provider: "claude",
    launch_header: "",
    status: "online" as const,
    device_info: "",
    metadata: {},
    last_seen_at: null,
    created_at: "2026-10-23T00:00:00Z",
    updated_at: "2026-10-23T00:00:00Z",
  };
  const runtime = {
    ...base,
    owner_id: OWNER,
    visibility: "private" as const,
    shared_with: [ALICE],
  };

  it("lets a granted member use a private runtime", () => {
    // This is the half that made the phone disagree with the server: the
    // server allowed the bind, the picker refused it.
    expect(isRuntimeUsableForUser(runtime, ALICE)).toBe(true);
  });

  it("still refuses a member who was not granted", () => {
    expect(isRuntimeUsableForUser(runtime, BOB)).toBe(false);
  });

  it("still refuses when the grant list is absent entirely", () => {
    expect(
      isRuntimeUsableForUser(
        { ...base, owner_id: OWNER, visibility: "private" },
        ALICE,
      ),
    ).toBe(false);
  });

  it("leaves public and owner rules untouched", () => {
    expect(
      isRuntimeUsableForUser(
        { ...base, owner_id: OWNER, visibility: "public" },
        BOB,
      ),
    ).toBe(true);
    expect(isRuntimeUsableForUser(runtime, OWNER)).toBe(true);
    expect(
      isRuntimeUsableForUser(
        { ...base, owner_id: null, visibility: "public" },
        ALICE,
      ),
    ).toBe(false);
  });
});
