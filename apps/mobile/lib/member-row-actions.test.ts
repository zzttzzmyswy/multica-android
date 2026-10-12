/**
 * The members-list row actions (iteration 231, MYS-2102) — the mobile port of
 * web's `MemberRow` menu
 * (`packages/views/settings/components/members-tab.tsx:100-171`).
 *
 * The permission rules themselves are already pinned by
 * `member-guards.test.ts`; this suite covers the two things web's ROW adds on
 * top of them, both of which a plausible edit gets wrong:
 *
 *   1. the owner entry disappears for a non-owner actor (web `:131`) — listing
 *      it would offer a write the server rejects with 403;
 *   2. on the workspace's last owner the demote entries are present but
 *      inert-with-a-hint (web `:133-141`), rather than absent.
 *
 * This deployment has exactly one member (the owner), so neither branch is
 * reachable on-device — which is why they are pinned here instead.
 */
import { describe, expect, it } from "vitest";
import type { MemberWithUser } from "@multica/core/types";
import { memberRowActions } from "./member-row-actions";

function member(overrides: Partial<MemberWithUser> = {}): MemberWithUser {
  return {
    id: "m1",
    workspace_id: "w1",
    user_id: "u-other",
    role: "member",
    created_at: "2026-01-01T00:00:00Z",
    name: "Ada",
    email: "ada@example.com",
    avatar_url: null,
    ...overrides,
  } as MemberWithUser;
}

const OWNER = "u-owner";
const ADMIN = "u-admin";
const OTHER = "u-other";

describe("memberRowActions — the menu's items", () => {
  it("gives an owner both entries on a normal member", () => {
    const r = memberRowActions(member(), {
      currentRole: "owner",
      currentUserId: OWNER,
      ownerCount: 2,
    });
    expect(r.actions).toEqual(["change-role", "remove"]);
    expect(r.showMenu).toBe(true);
  });

  it("hides the menu entirely on your own row", () => {
    // Web's `!isSelf` half. Self-service role changes are not a thing, and
    // removing yourself is what "leave workspace" is for.
    const r = memberRowActions(member({ user_id: OWNER }), {
      currentRole: "owner",
      currentUserId: OWNER,
      ownerCount: 2,
    });
    expect(r.actions).toEqual([]);
    expect(r.showMenu).toBe(false);
    expect(r.roleChoices).toEqual([]);
  });

  it("hides the menu from a plain member", () => {
    const r = memberRowActions(member(), {
      currentRole: "member",
      currentUserId: OTHER,
      ownerCount: 2,
    });
    expect(r.showMenu).toBe(false);
  });

  it("lets an admin manage a normal member", () => {
    const r = memberRowActions(member({ user_id: OTHER }), {
      currentRole: "admin",
      currentUserId: ADMIN,
      ownerCount: 2,
    });
    expect(r.actions).toEqual(["change-role", "remove"]);
  });

  it("withholds the menu from an admin targeting an owner", () => {
    // Web's `(role !== "owner" || canManageOwners)`: only an owner may act on
    // an owner. The server enforces the same (`workspace.go` requester.Role).
    const r = memberRowActions(member({ role: "owner" }), {
      currentRole: "admin",
      currentUserId: OTHER,
      ownerCount: 2,
    });
    expect(r.showMenu).toBe(false);
  });

  it("fails closed while the role is still unknown", () => {
    const r = memberRowActions(member(), {
      currentRole: null,
      currentUserId: OTHER,
      ownerCount: 2,
    });
    expect(r.showMenu).toBe(false);
  });
});

describe("memberRowActions — the role submenu", () => {
  it("offers owner/admin/member to an owner actor", () => {
    const r = memberRowActions(member({ role: "member" }), {
      currentRole: "owner",
      currentUserId: OWNER,
      ownerCount: 3,
    });
    expect(r.roleChoices.map((c) => c.role)).toEqual(["owner", "admin", "member"]);
  });

  it("drops the owner entry for an admin actor", () => {
    // Web's `if (role === "owner" && !canManageOwners) return null` (:131).
    // The server rejects a non-owner promoting anyone to owner with 403, so
    // listing it would only produce a failed mutation.
    const r = memberRowActions(member({ user_id: OTHER, role: "member" }), {
      currentRole: "admin",
      currentUserId: ADMIN,
      ownerCount: 3,
    });
    expect(r.roleChoices.map((c) => c.role)).toEqual(["admin", "member"]);
  });

  it("offers no roles at all when the menu is hidden", () => {
    const r = memberRowActions(member(), {
      currentRole: "member",
      currentUserId: OTHER,
      ownerCount: 2,
    });
    expect(r.roleChoices).toEqual([]);
  });

  it("ticks the member's current role and only that one", () => {
    const r = memberRowActions(member({ role: "admin" }), {
      currentRole: "owner",
      currentUserId: OWNER,
      ownerCount: 3,
    });
    expect(r.roleChoices.filter((c) => c.current).map((c) => c.role)).toEqual(["admin"]);
    expect(r.roleChoices.filter((c) => c.current)).toHaveLength(1);
  });
});

describe("memberRowActions — the last owner", () => {
  it("disables every non-owner entry on the workspace's only owner", () => {
    // Web's `wouldDemoteLastOwner = isLastOwner && role !== "owner"` (:133-141).
    // The entries stay on screen — web swaps their description for
    // `cannot_demote_last_owner` — so they must be PRESENT and DISABLED, which
    // is a different shape from omitted.
    const r = memberRowActions(member({ user_id: OTHER, role: "owner" }), {
      currentRole: "owner",
      currentUserId: OWNER,
      ownerCount: 1,
    });
    expect(r.roleChoices.map((c) => c.role)).toEqual(["owner", "admin", "member"]);
    const disabled = r.roleChoices.filter((c) => c.disabled).map((c) => c.role);
    expect(disabled).toEqual(["admin", "member"]);
    // The owner entry itself is never disabled: keeping it is the no-op.
    expect(r.roleChoices.find((c) => c.role === "owner")?.disabled).toBe(false);
  });

  it("leaves the demote entries enabled once a second owner exists", () => {
    // The guard is `ownerCount <= 1`, not "target is an owner" — with two
    // owners, demoting one is exactly what the workspace needs to be able to
    // do.
    const r = memberRowActions(member({ user_id: OTHER, role: "owner" }), {
      currentRole: "owner",
      currentUserId: OWNER,
      ownerCount: 2,
    });
    expect(r.roleChoices.filter((c) => c.disabled)).toEqual([]);
  });

  it("does not disable a non-owner target's entries", () => {
    // `isLastOwner` is about the TARGET being the last owner. An admin
    // targeting a plain member on a one-owner workspace must keep a working
    // demote/promote set.
    const r = memberRowActions(member({ user_id: OTHER, role: "admin" }), {
      currentRole: "owner",
      currentUserId: OWNER,
      ownerCount: 1,
    });
    expect(r.roleChoices.filter((c) => c.disabled)).toEqual([]);
  });

  it("keeps remove available on the last owner", () => {
    // Web gates `canRemove` on the same expression as `canEditRole`, and the
    // last-owner rule only disables the role ENTRIES — the client cannot know
    // whether removal is what the user intends. A round that "helpfully" hid
    // remove here would be a product change, not a parity one.
    const r = memberRowActions(member({ user_id: OTHER, role: "owner" }), {
      currentRole: "owner",
      currentUserId: OWNER,
      ownerCount: 1,
    });
    expect(r.actions).toContain("remove");
  });
});
