import { describe, expect, it } from "vitest";
import {
  deriveRuntimePermissions,
  isSelfHealingRuntime,
  parseActiveAgentsConflict,
} from "./runtime-management";

const owner = { role: "owner", user_id: "u-owner" };
const admin = { role: "admin", user_id: "u-admin" };
const member = { role: "member", user_id: "u-member" };
const MEMBERS = [owner, admin, member];

describe("deriveRuntimePermissions", () => {
  // built-in runtime owned by u-owner; admin is u-admin; viewer is u-member
  const builtinRuntime = (ownerId: string | null = "u-owner") => ({
    owner_id: ownerId,
    profile_id: null,
  });
  const customRuntime = (ownerId: string | null = "u-owner") => ({
    owner_id: ownerId,
    profile_id: "prof-1",
  });

  it("runtime owner (member role) can edit but visibility is owner-only and delete is allowed on built-in", () => {
    const p = deriveRuntimePermissions({
      members: MEMBERS,
      currentUserId: "u-member",
      runtime: builtinRuntime("u-member"),
    });
    expect(p.isAdmin).toBe(false);
    expect(p.isRuntimeOwner).toBe(true);
    expect(p.canEditRuntime).toBe(true);
    expect(p.canEditVisibility).toBe(true);
    expect(p.canDelete).toBe(true);
  });

  it("workspace admin can edit and delete built-in but cannot flip visibility (owner-only, MUL-6126)", () => {
    const p = deriveRuntimePermissions({
      members: MEMBERS,
      currentUserId: "u-admin",
      runtime: builtinRuntime(),
    });
    expect(p.isAdmin).toBe(true);
    expect(p.isRuntimeOwner).toBe(false);
    expect(p.canEditRuntime).toBe(true);
    expect(p.canEditVisibility).toBe(false);
    expect(p.canDelete).toBe(true);
  });

  it("workspace owner role admin counts as admin too", () => {
    const p = deriveRuntimePermissions({
      members: MEMBERS,
      currentUserId: "u-owner",
      runtime: builtinRuntime("someone-else"),
    });
    expect(p.isAdmin).toBe(true);
    expect(p.canEditRuntime).toBe(true);
    expect(p.canEditVisibility).toBe(false);
    expect(p.canDelete).toBe(true);
  });

  it("plain member without ownership is read-only", () => {
    const p = deriveRuntimePermissions({
      members: MEMBERS,
      currentUserId: "u-member",
      runtime: builtinRuntime(),
    });
    expect(p.isAdmin).toBe(false);
    expect(p.isRuntimeOwner).toBe(false);
    expect(p.canEditRuntime).toBe(false);
    expect(p.canEditVisibility).toBe(false);
    expect(p.canDelete).toBe(false);
  });

  it("custom runtime delete is admin-only even for the visible owner (MUL-5559)", () => {
    const ownerMember = deriveRuntimePermissions({
      members: MEMBERS,
      currentUserId: "u-member",
      runtime: customRuntime("u-member"),
    });
    expect(ownerMember.canDelete).toBe(false);
    expect(ownerMember.canEditRuntime).toBe(true);
    expect(ownerMember.canEditVisibility).toBe(true);

    const ownerRoleMember = deriveRuntimePermissions({
      members: MEMBERS,
      currentUserId: "u-owner",
      runtime: customRuntime("u-owner"),
    });
    expect(ownerRoleMember.canDelete).toBe(true);

    const adminMember = deriveRuntimePermissions({
      members: MEMBERS,
      currentUserId: "u-admin",
      runtime: customRuntime(),
    });
    expect(adminMember.canDelete).toBe(true);
  });

  it("unauthenticated viewer gets no permissions", () => {
    const p = deriveRuntimePermissions({
      members: MEMBERS,
      currentUserId: null,
      runtime: builtinRuntime(),
    });
    expect(p.isAdmin).toBe(false);
    expect(p.canEditRuntime).toBe(false);
    expect(p.canDelete).toBe(false);
    expect(p.canEditVisibility).toBe(false);
  });

  it("empty members list never grants admin — owner can still delete own built-in", () => {
    const p = deriveRuntimePermissions({
      members: [],
      currentUserId: "u-owner",
      runtime: builtinRuntime("u-owner"),
    });
    expect(p.isAdmin).toBe(false);
    expect(p.canEditRuntime).toBe(true);
    expect(p.canDelete).toBe(true);
  });
});

describe("isSelfHealingRuntime", () => {
  it("true for an online local daemon", () => {
    expect(isSelfHealingRuntime({ runtime_mode: "local", status: "online" })).toBe(
      true,
    );
  });

  it("false for an offline local daemon", () => {
    expect(isSelfHealingRuntime({ runtime_mode: "local", status: "offline" })).toBe(
      false,
    );
  });

  it("false for an online cloud worker", () => {
    expect(isSelfHealingRuntime({ runtime_mode: "cloud", status: "online" })).toBe(
      false,
    );
  });
});

describe("parseActiveAgentsConflict", () => {
  const conflict = (code: string, activeAgents?: unknown) => ({
    status: 409,
    body: { code, ...(activeAgents !== undefined ? { active_agents: activeAgents } : {}) },
  });

  it("parses runtime_has_active_agents from a structured 409 ApiError", () => {
    const err = conflict("runtime_has_active_agents", [
      { id: "a1", name: "agent-1", runtime_id: "r1" },
      { id: "a2", name: "agent-2", runtime_id: "r1" },
    ]);
    const parsed = parseActiveAgentsConflict(err);
    expect(parsed).toEqual({
      code: "runtime_has_active_agents",
      activeAgents: [
        { id: "a1", name: "agent-1", runtime_id: "r1" },
        { id: "a2", name: "agent-2", runtime_id: "r1" },
      ],
    });
  });

  it("parses runtime_delete_plan_changed the same way (re-selected plan)", () => {
    const parsed = parseActiveAgentsConflict(
      conflict("runtime_delete_plan_changed", [{ id: "b1", name: "agent-b" }]),
    );
    expect(parsed?.code).toBe("runtime_delete_plan_changed");
    expect(parsed?.activeAgents).toEqual([{ id: "b1", name: "agent-b" }]);
  });

  it("returns null for a non-409 error (generic failure toast)", () => {
    expect(parseActiveAgentsConflict({ status: 400, body: {} })).toBeNull();
    expect(parseActiveAgentsConflict(new Error("boom"))).toBeNull();
    expect(parseActiveAgentsConflict(undefined)).toBeNull();
    expect(parseActiveAgentsConflict(null)).toBeNull();
  });

  it("returns null for a 409 without a recognized code", () => {
    expect(parseActiveAgentsConflict({ status: 409, body: { code: "other" } })).toBeNull();
    expect(parseActiveAgentsConflict({ status: 409, body: null })).toBeNull();
  });

  it("collapses a missing/malformed active_agents to an empty plan", () => {
    const noList = parseActiveAgentsConflict(conflict("runtime_has_active_agents"));
    expect(noList).toEqual({
      code: "runtime_has_active_agents",
      activeAgents: [],
    });
    const notArray = parseActiveAgentsConflict(
      conflict("runtime_has_active_agents", { nope: true }),
    );
    expect(notArray?.activeAgents).toEqual([]);
  });

  it("drops malformed agent rows that lack id/name", () => {
    const parsed = parseActiveAgentsConflict(
      conflict("runtime_has_active_agents", [
        { id: "ok", name: "fine" },
        { name: "no-id" },
        { id: "no-name" },
        "not-an-object",
      ]),
    );
    expect(parsed?.activeAgents).toEqual([{ id: "ok", name: "fine" }]);
  });
});