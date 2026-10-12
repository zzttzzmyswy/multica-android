/**
 * Wiring ratchet for the members-list row actions (iteration 231, MYS-2102).
 *
 * `lib/member-row-actions.test.ts` proves the decisions answer correctly and
 * `member-guards.test.ts` already pins the permission rules. None of that
 * reaches a user unless the LIST screen renders the kebab and routes its
 * choices to the real mutations — the helper could exist and stay unused while
 * every row remained a bare `router.push` to the detail page, which is what the
 * BEFORE probe measured (0 kebab nodes).
 *
 * The assertions that matter most:
 *   - the screen must NOT re-derive the guards; it feeds `ownerCount` and the
 *     actor's role/user id into the shared helper, which delegates to
 *     `member-guards`, so the list and the detail page cannot disagree about
 *     the last owner;
 *   - the role-change and remove paths must reuse the DETAIL page's copy and
 *     failure titles, because those are the two other entry points to the same
 *     writes.
 *
 * Mobile's vitest lane is Node-only, so this is asserted against source rather
 * than rendered markup. Comments are stripped so a comment describing the
 * wiring cannot satisfy it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const LIST = "app/(app)/[workspace]/more/members.tsx";
const ROW_MENU = "components/member/member-row-menu.tsx";
const DETAIL = "app/(app)/[workspace]/more/members/[id].tsx";

describe("the members list exposes a row kebab", () => {
  const src = code(LIST);

  it("mounts the shared row menu on every rendered row", () => {
    expect(src).toContain("<MemberRowMenu");
    expect(src).toContain("onRoleChange={onRoleChange}");
    expect(src).toContain("onRemove={onRemoveMember}");
  });

  it("threads the inputs the last-owner guard needs", () => {
    // Without `ownerCount` the guard's default of 2 makes every owner look
    // demotable; without the actor's user id, self-protection disappears.
    expect(src).toContain("ownerCount={ownerCount}");
    expect(src).toContain("currentUserId={user?.id}");
    expect(src).toContain("currentRole={role}");
    expect(src).toContain("(rawMembers ?? []).filter((m) => m.role === \"owner\")");
  });

  it("owns both writes, so the kebab and the detail page share them", () => {
    expect(src).toContain("useUpdateMemberRole()");
    expect(src).toContain("useRemoveMember()");
    expect(src).toContain("updateMemberRole.mutate(");
    expect(src).toContain("removeMember.mutate(");
  });

  it("does not re-derive the permission rules inline", () => {
    // The guards live in lib/member-guards.ts via lib/member-row-actions.ts.
    // A second copy of "you cannot demote the last owner" is the fork this
    // prevents.
    expect(src).not.toContain("memberManageGuards(");
    expect(src).not.toContain("wouldDemoteLastOwner");
    expect(src).not.toContain("canEditRole");
  });

  it("reuses the detail page's role / remove copy and failure titles", () => {
    // The detail page is the other entry point to both writes; if the keys
    // move, both must move.
    const detail = code(DETAIL);
    for (const key of [
      "members.detail.roleUpdated",
      "members.detail.roleUpdateFailed",
      "members.detail.removeTitle",
      "members.detail.removeMessage",
      "members.detail.removeAction",
      "members.detail.removeFailed",
    ]) {
      expect(detail, `detail no longer renders ${key}`).toContain(key);
      expect(src, `list does not render ${key}`).toContain(key);
    }
  });

  it("names the workspace in the remove confirm", () => {
    // `members.detail.removeMessage` interpolates `{{workspace}}`; omitting it
    // renders the placeholder text to the user.
    expect(src).toContain("workspaceListOptions()");
    expect(src).toContain("workspace: workspaceName");
  });

  it("still routes the row tap to the detail page", () => {
    // The kebab adds an entry point; it must not replace the row's own.
    expect(src).toContain("more/members/${member.id}");
  });
});

describe("the row menu is a thin host over the shared decisions", () => {
  const menu = code(ROW_MENU);

  it("asks the shared helper which items to show", () => {
    expect(menu).toContain("memberRowActions(");
  });

  it("returns nothing rather than opening an empty sheet", () => {
    expect(menu).toMatch(/if \(actions\.length === 0\) return null;/);
  });

  it("does not write to the server itself", () => {
    expect(menu).not.toContain("useUpdateMemberRole");
    expect(menu).not.toContain("useRemoveMember");
    expect(menu).not.toContain("mutate");
  });

  it("flattens the role submenu instead of hardcoding three roles", () => {
    // The entries come from `roleChoices`, which the helper derives from
    // `roleChangeOptions` — the owner entry must disappear for a non-owner
    // actor, and a literal `["owner","admin","member"]` would put it back.
    expect(menu).toContain("roleChoices");
    expect(menu).not.toContain('["owner", "admin", "member"]');
    expect(menu).not.toContain("roleChangeOptions(");
  });

  it("intercepts the disabled demote entry with the hint, not a silent no-op", () => {
    // A native action sheet has no per-option disabled state, so web's
    // `disabled` + swapped description becomes an alert carrying the same
    // sentence.
    expect(menu).toContain("members.detail.cannotDemoteLastOwner");
  });

  it("marks remove destructive and change-role not", () => {
    expect(menu).toContain('actions.indexOf("remove")');
  });
});

describe("every key the new surface renders exists in both locales", () => {
  const en = JSON.parse(
    readFileSync(path.join(APP_ROOT, "lib/i18n/locales/en.json"), "utf8"),
  ) as Record<string, string>;
  const zh = JSON.parse(
    readFileSync(path.join(APP_ROOT, "lib/i18n/locales/zh.json"), "utf8"),
  ) as Record<string, string>;

  const NEW_KEYS = ["members.actions.open"];

  for (const key of NEW_KEYS) {
    it(`${key} resolves in en and zh`, () => {
      expect(en[key], `en missing ${key}`).toBeTruthy();
      expect(zh[key], `zh missing ${key}`).toBeTruthy();
    });
  }

  it("matches web's wording for the trigger's a11y label", () => {
    expect(zh["members.actions.open"]).toBe("{{name}} 的操作");
    expect(en["members.actions.open"]).toBe("Actions for {{name}}");
  });
});
