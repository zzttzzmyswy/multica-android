import { describe, expect, it } from "vitest";
import {
  canChangeProjectLead,
  canManageProjectAccess,
  canRemoveProjectMember,
  projectAccessSelection,
  projectVisibilityIsPrivate,
  resolveProjectVisibility,
  visibilityRequiresPublishConfirm,
} from "./project-access";

/**
 * Mirrors of `packages/core/projects/access.ts` (deployed tag
 * `v0.9.0-myswy.2`) and of the server's own rule in
 * `server/internal/handler/project_member.go:canManageProjectAccess` +
 * `prepareProjectAccessUpdate`.
 *
 * Each case below is a claim about WHO may do WHAT. They are not
 * interchangeable, and collapsing any pair is a permission bug the server
 * answers with 403 — or worse, one it does not answer at all.
 */

const OWNER = "user-owner";
const ADMIN = "user-admin";
const LEAD = "user-lead";
const PLAIN = "user-plain";

const privateProject = (leadType: "member" | "agent" | null, leadId: string | null) => ({
  visibility: "private" as const,
  lead_type: leadType,
  lead_id: leadId,
});

const publicProject = (leadType: "member" | "agent" | null, leadId: string | null) => ({
  visibility: "workspace" as const,
  lead_type: leadType,
  lead_id: leadId,
});

describe("canManageProjectAccess (mirrors core/projects/access.ts)", () => {
  it("grants owners and admins every project", () => {
    expect(canManageProjectAccess(privateProject(null, null), OWNER, "owner")).toBe(true);
    expect(canManageProjectAccess(privateProject(null, null), ADMIN, "admin")).toBe(true);
    // ...and on a public project too, where nobody else needs the permission.
    expect(canManageProjectAccess(publicProject(null, null), OWNER, "owner")).toBe(true);
  });

  it("grants the member lead of a PRIVATE project", () => {
    expect(canManageProjectAccess(privateProject("member", LEAD), LEAD, "member")).toBe(true);
  });

  it("denies a plain member of a private project", () => {
    expect(canManageProjectAccess(privateProject("member", LEAD), PLAIN, "member")).toBe(false);
  });

  it("denies the lead of a WORKSPACE project", () => {
    // Leading a public project grants nothing: anyone may set that lead, so it
    // must not become a path to managing its access. The server's rule is
    // gated on `visibility == private` for exactly this reason.
    expect(canManageProjectAccess(publicProject("member", LEAD), LEAD, "member")).toBe(false);
  });

  it("denies an AGENT lead even on a private project", () => {
    // An agent lead's `lead_id` is an agent id, not a user id; and agents never
    // hold access-management rights (requireHumanProjectAccessActor).
    expect(canManageProjectAccess(privateProject("agent", LEAD), LEAD, "member")).toBe(false);
  });

  it("denies everyone when the user is unknown", () => {
    expect(canManageProjectAccess(privateProject("member", LEAD), null, "owner")).toBe(false);
    expect(canManageProjectAccess(privateProject("member", LEAD), undefined, "admin")).toBe(false);
  });

  it("denies a member whose role has not resolved yet", () => {
    // Previously "not an admin", and the lead branch still applies — so a lead
    // keeps the affordance during the roster read, and a plain member must not
    // gain one.
    expect(canManageProjectAccess(privateProject("member", LEAD), LEAD, null)).toBe(true);
    expect(canManageProjectAccess(privateProject("member", LEAD), PLAIN, null)).toBe(false);
  });
});

describe("canChangeProjectLead (degenerates to access management on private)", () => {
  it("lets anyone change the lead of a WORKSPACE project", () => {
    // Pre-existing, correct behaviour: the lead is an ordinary field there.
    // Narrowing this too would break a public project's normal editing.
    expect(canChangeProjectLead(publicProject("member", LEAD), PLAIN, "member")).toBe(true);
    expect(canChangeProjectLead(publicProject(null, null), null, null)).toBe(true);
  });

  it("restricts the lead of a PRIVATE project to its access managers", () => {
    expect(canChangeProjectLead(privateProject("member", LEAD), LEAD, "member")).toBe(true);
    expect(canChangeProjectLead(privateProject("member", LEAD), OWNER, "owner")).toBe(true);
    expect(canChangeProjectLead(privateProject("member", LEAD), PLAIN, "member")).toBe(false);
  });
});

describe("canRemoveProjectMember (self and lead are fixed)", () => {
  it("refuses to remove the lead", () => {
    // The server answers 409 "change the project lead before removing the
    // current lead"; offering the control anyway is a guaranteed failure.
    expect(canRemoveProjectMember({ targetId: LEAD, leadId: LEAD, canManage: true })).toBe(false);
  });

  it("refuses to remove yourself", () => {
    // Self-removal from a private project silently locks the user out.
    expect(
      canRemoveProjectMember({ targetId: PLAIN, currentUserId: PLAIN, leadId: LEAD, canManage: true }),
    ).toBe(false);
  });

  it("allows removing another ordinary member", () => {
    expect(
      canRemoveProjectMember({ targetId: PLAIN, currentUserId: LEAD, leadId: LEAD, canManage: true }),
    ).toBe(true);
  });

  it("allows nobody without the manage permission", () => {
    expect(
      canRemoveProjectMember({ targetId: PLAIN, currentUserId: ADMIN, leadId: LEAD, canManage: false }),
    ).toBe(false);
  });
});

describe("resolveProjectVisibility / projectVisibilityIsPrivate", () => {
  it("treats a missing visibility as workspace, never as private", () => {
    // `.default("workspace")` in the schema exists to absorb an older server
    // that omits the key. Treating "absent" as private would paint a lock on
    // every project the moment a response shape changed.
    expect(resolveProjectVisibility({})).toBe("workspace");
    expect(resolveProjectVisibility({ visibility: undefined })).toBe("workspace");
    expect(projectVisibilityIsPrivate({})).toBe(false);
    expect(projectVisibilityIsPrivate({ visibility: undefined })).toBe(false);
  });

  it("recognises private only from the literal", () => {
    expect(resolveProjectVisibility({ visibility: "private" })).toBe("private");
    expect(projectVisibilityIsPrivate({ visibility: "private" })).toBe(true);
    expect(projectVisibilityIsPrivate({ visibility: "workspace" })).toBe(false);
  });

  it("folds an unknown server value to workspace rather than dropping it", () => {
    // A future enum member must render as something, and "not private" is the
    // only safe reading for a client that cannot enforce the unknown value.
    expect(resolveProjectVisibility({ visibility: "team" as never })).toBe("workspace");
  });
});

describe("visibilityRequiresPublishConfirm", () => {
  it("requires confirmation when widening private → workspace", () => {
    // Irreversible leak: issues, comments and attachments become visible to the
    // whole workspace, and having been visible cannot be taken back.
    expect(visibilityRequiresPublishConfirm("private", "workspace")).toBe(true);
  });

  it("does not confirm narrowing to private, or an unchanged value", () => {
    expect(visibilityRequiresPublishConfirm("workspace", "private")).toBe(false);
    expect(visibilityRequiresPublishConfirm("workspace", "workspace")).toBe(false);
    expect(visibilityRequiresPublishConfirm("private", "private")).toBe(false);
  });
});

describe("projectAccessSelection (what the member list starts from)", () => {
  it("seeds a first switch to private with the caller and the member lead", () => {
    // Otherwise the person making the project private would exclude themselves
    // from it. Web seeds exactly these (`project-access.tsx:147`), and so does
    // the server (`prepareProjectAccessUpdate` appends both).
    expect(
      projectAccessSelection({
        currentVisibility: "workspace",
        currentMemberIds: [],
        currentUserId: PLAIN,
        leadId: LEAD,
        draftIds: null,
      }),
    ).toEqual([PLAIN, LEAD]);
  });

  it("uses the server's member list verbatim once the project IS private", () => {
    const ids = projectAccessSelection({
      currentVisibility: "private",
      currentMemberIds: [LEAD, PLAIN],
      currentUserId: ADMIN,
      leadId: LEAD,
      draftIds: [PLAIN],
    });
    expect(ids).toEqual([LEAD, PLAIN]);
  });

  it("honours the local draft while the project is still public", () => {
    expect(
      projectAccessSelection({
        currentVisibility: "workspace",
        currentMemberIds: [],
        currentUserId: PLAIN,
        leadId: LEAD,
        draftIds: [PLAIN, LEAD, ADMIN],
      }),
    ).toEqual([PLAIN, LEAD, ADMIN]);
  });

  it("de-duplicates a lead who is also the caller", () => {
    expect(
      projectAccessSelection({
        currentVisibility: "workspace",
        currentMemberIds: [],
        currentUserId: LEAD,
        leadId: LEAD,
        draftIds: null,
      }),
    ).toEqual([LEAD]);
  });
});

/**
 * The inherited `ProjectSchema` / `ListProjectMembersResponseSchema` against
 * bodies captured verbatim from the live deployment (`mu.zztweb.top`, probed
 * 2026-11-17). A schema that merely type-checks can still reject the real
 * wire shape; these are the real ones.
 */
describe("project schemas accept the live deployment's bodies", () => {
  it("parses a live row carrying visibility, and folds a missing one to workspace", async () => {
    const { ProjectSchema } = await import("@/data/schemas");
    const live = {
      id: "ffa32e8d", workspace_id: "ws", title: "probe",
      description: null, icon: null, status: "planned", priority: "none",
      lead_type: null, lead_id: null, start_date: null, due_date: null,
      created_at: "2026-11-17T00:33:27+08:00", updated_at: "2026-11-17T00:33:27+08:00",
      issue_count: 0, done_count: 0, resource_count: 0, workflow_id: null,
      visibility: "private",
    };
    expect(ProjectSchema.parse(live).visibility).toBe("private");
    const { visibility: _dropped, ...withoutVisibility } = live;
    expect(ProjectSchema.parse(withoutVisibility).visibility).toBe("workspace");
  });

  it("parses the live member body, which omits workspace_role", async () => {
    const { ListProjectMembersResponseSchema } = await import("@/data/schemas");
    const res = ListProjectMembersResponseSchema.parse({
      members: [{
        project_id: "p", user_id: "u", name: "MYSWY", email: "x@y.z",
        avatar_url: null, added_by: "u", created_at: "2026-11-17T00:33:27+08:00",
      }],
      total: 1,
    });
    // Absent workspace_role must not read as a fabricated role string; the UI
    // falls back to the workspace directory (see components/project/access).
    expect(res.members[0].workspace_role).toBe("");
    expect(res.total).toBe(1);
  });
});
