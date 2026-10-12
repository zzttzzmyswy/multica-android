/**
 * Wiring ratchet for the squads-list row actions (iteration 231, MYS-2102).
 *
 * `lib/squad-row-actions.test.ts` proves the decisions answer correctly. None of
 * that reaches a user unless the LIST screen renders the kebab and routes its
 * choice to the real mutation — the helper could exist and stay unused while
 * every row remained a bare `router.push` to the detail page, which is what the
 * BEFORE probe measured (0 kebab nodes).
 *
 * The assertion that matters most is the gate's SHAPE. The screen already has an
 * `isAdmin` value for the header "+", and reusing it for the kebab would look
 * right on this deployment — whose single squad was created by the workspace
 * owner, so the admin half and the creator half agree on every row. Web's cell
 * gate is per-row (MUL-4223), so the screen must pass the role and user id DOWN
 * to the helper rather than deciding once for the whole list.
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

const LIST = "app/(app)/[workspace]/more/squads.tsx";
const ROW_MENU = "components/squad/squad-row-menu.tsx";
const DETAIL = "app/(app)/[workspace]/more/squads/[id].tsx";

describe("the squads list exposes a row kebab", () => {
  const src = code(LIST);

  it("mounts the shared row menu on every rendered row", () => {
    expect(src).toContain("<SquadRowMenu");
    expect(src).toContain("onArchive={onArchive}");
  });

  it("gates per ROW, passing the actor down instead of one screen-level flag", () => {
    // `isAdmin` stays the header "+"'s gate. The kebab must not read it.
    expect(src).toContain("currentRole={currentMember?.role}");
    expect(src).toContain("currentUserId={user?.id}");
    // The row component must not collapse the two halves itself.
    const row = src.slice(src.indexOf("function SquadRow("));
    expect(row).not.toContain("isAdmin");
    expect(row).not.toContain("isWorkspaceAdmin");
  });

  it("does not decide the gate with the screen-level admin flag", () => {
    // A single `{isAdmin ? <SquadRowMenu … /> : null}` would drop the creator
    // half entirely. The menu owns that decision, via the shared helper.
    expect(src).not.toContain("{isAdmin ? (");
    expect(src).not.toContain("squadRowActions(");
  });

  it("owns the archive write, so the kebab and the detail page share it", () => {
    expect(src).toContain("useDeleteSquad()");
    expect(src).toContain("deleteSquad.mutate(");
  });

  it("confirms through web's `archive_dialog` copy, verbatim", () => {
    // The description is load-bearing: archiving transfers the squad's issues
    // to its leader and there is no un-archive endpoint.
    for (const key of [
      "squads.archive.title",
      "squads.archive.description",
      "squads.archive.cancel",
      "squads.archive.confirm",
    ]) {
      expect(src, `list does not render ${key}`).toContain(key);
    }
  });

  it("reuses the detail page's archive failure title", () => {
    expect(code(DETAIL)).toContain("squads.detail.archiveFailed");
    expect(src).toContain("squads.detail.archiveFailed");
  });

  it("reports success, because archive has off-screen effects", () => {
    // The only success alert among this round's four surfaces. A delete's
    // vanished row is its own confirmation; archiving additionally reassigns
    // the squad's issues to its leader, which nothing on this screen shows.
    expect(src).toContain("squads.archive.success");
  });

  it("routes the row tap through one push helper", () => {
    expect(src).toContain("const openDetail = useCallback(");
    expect(src).toContain("onPress={() => openDetail(item)}");
    expect(src.match(/more\/squads\/\$\{/g) ?? []).toHaveLength(1);
  });
});

describe("the row menu is a thin host over the shared decisions", () => {
  const menu = code(ROW_MENU);

  it("asks the shared helper which items to show", () => {
    expect(menu).toContain("squadRowActions(");
  });

  it("returns nothing rather than opening an empty sheet", () => {
    expect(menu).toMatch(/if \(actions\.length === 0\) return null;/);
  });

  it("does not write to the server itself", () => {
    expect(menu).not.toContain("useDeleteSquad");
    expect(menu).not.toContain("mutate");
  });

  it("routes archive to the callback the screen supplied", () => {
    expect(menu).toContain("onArchive(squad)");
  });

  it("does not re-derive the gate inline", () => {
    // `squadManageGuards` is the one encoding of MUL-4223; a second
    // `creator_id === currentUserId` here is the fork this prevents.
    expect(menu).not.toContain("creator_id ===");
    expect(menu).not.toContain("squadManageGuards(");
  });

  it("offers no restore entry — the server has no un-archive route", () => {
    expect(menu).not.toContain("restore");
  });
});

describe("every key the new surface renders exists in both locales", () => {
  const en = JSON.parse(
    readFileSync(path.join(APP_ROOT, "lib/i18n/locales/en.json"), "utf8"),
  ) as Record<string, string>;
  const zh = JSON.parse(
    readFileSync(path.join(APP_ROOT, "lib/i18n/locales/zh.json"), "utf8"),
  ) as Record<string, string>;

  const NEW_KEYS = [
    "squads.actions.open",
    "squads.archive.title",
    "squads.archive.description",
    "squads.archive.cancel",
    "squads.archive.confirm",
  ];

  for (const key of NEW_KEYS) {
    it(`${key} resolves in en and zh`, () => {
      expect(en[key], `en missing ${key}`).toBeTruthy();
      expect(zh[key], `zh missing ${key}`).toBeTruthy();
    });
  }

  it("matches web's squads.json wording verbatim for the archive dialog", () => {
    // Copied from packages/views/locales/{en,zh-Hans}/squads.json so a phone
    // and a desktop describe the same irreversible action identically.
    expect(zh["squads.archive.title"]).toBe("归档这个小队？");
    expect(zh["squads.archive.confirm"]).toBe("归档");
    expect(zh["squads.archive.cancel"]).toBe("取消");
    expect(zh["squads.archive.description"]).toContain("{{name}}");
    expect(en["squads.archive.title"]).toBe("Archive this squad?");
  });

  it("matches web's wording for the trigger's a11y label", () => {
    expect(zh["squads.actions.open"]).toBe("小队操作");
    expect(en["squads.actions.open"]).toBe("Squad actions");
  });
});
