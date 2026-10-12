/**
 * Wiring ratchet for the properties-list row actions (iteration 231, MYS-2102).
 *
 * `lib/property-row-actions.test.ts` proves the decisions answer correctly.
 * None of that reaches a user unless the LIST screen renders the kebab and
 * routes its choices to the real mutation — the helper could exist and stay
 * unused while every row remained a bare `router.push` to the edit form, which
 * is what the BEFORE probe measured (0 kebab nodes).
 *
 * The two assertions that matter most are the ones a "tidy-up" would break:
 * the screen must read its gate from `canManageProperties` rather than
 * re-writing `role === "owner" || role === "admin"` inline, and it must pass
 * that flag down so the menu renders nothing at all for a non-manager (web's
 * empty `<span />`, not a disabled button).
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

const LIST = "app/(app)/[workspace]/more/properties.tsx";
const ROW_MENU = "components/property/property-row-menu.tsx";
const FORM = "components/property/property-form.tsx";

describe("the properties list exposes a row kebab", () => {
  const src = code(LIST);

  it("mounts the shared row menu on every rendered row", () => {
    expect(src).toContain("<PropertyRowMenu");
    expect(src).toContain("onEdit={");
    expect(src).toContain("onArchive={");
    expect(src).toContain("onRestore={");
    expect(src).toContain("canManage={canManage}");
  });

  it("derives its gate from the shared predicate, not an inline role test", () => {
    expect(src).toContain("canManageProperties(currentMember?.role)");
    // The inline pair is exactly what `canManageProperties` replaces; two
    // copies is how the screen and the menu drift.
    expect(src).not.toContain('role === "owner" || currentMember?.role === "admin"');
  });

  it("owns the archive/restore write, so the kebab and the edit form share it", () => {
    expect(src).toContain("useUpdateProperty()");
    expect(src).toContain("updateProperty.mutate(");
  });

  it("writes the flipped flag, not a hardcoded one", () => {
    // Archive sets true, restore sets false — one branch serving both would
    // make one of the two menu items a no-op.
    expect(src).toContain("archived: true");
    expect(src).toContain("archived: false");
  });

  it("reuses the edit form's archive confirm verbatim", () => {
    // The form is the other entry point to the same write, so both must word
    // it the same way or "archive" means two different things on one screen.
    const form = code(FORM);
    for (const key of ["properties.archiveTitle", "properties.archiveMessage"]) {
      expect(form, `form no longer renders ${key}`).toContain(key);
      expect(src, `list does not render ${key}`).toContain(key);
    }
  });

  it("routes edit through the same push the row tap uses", () => {
    expect(src).toContain("const openEdit = useCallback(");
    expect(src).toContain("onPress={() => openEdit(item)}");
    expect(src).toContain("onEdit={() => openEdit(item)}");
    expect(src.match(/more\/properties\/\$\{/g) ?? []).toHaveLength(1);
  });
});

describe("the row menu is a thin host over the shared decisions", () => {
  const menu = code(ROW_MENU);

  it("asks the shared helper which items to show", () => {
    expect(menu).toContain("propertyRowActions(");
    expect(menu).toContain("canManage");
  });

  it("returns nothing rather than opening an empty sheet", () => {
    // This is the branch web renders as an empty `<span />`; the screen's
    // toolbar already carries the matching admin hint.
    expect(menu).toMatch(/if \(actions\.length === 0\) return null;/);
  });

  it("does not write to the server itself", () => {
    expect(menu).not.toContain("useUpdateProperty");
    expect(menu).not.toContain("mutate");
  });

  it("routes each item to the callback the screen supplied", () => {
    for (const branch of ["onEdit(property)", "onArchive(property)", "onRestore(property)"]) {
      expect(menu).toContain(branch);
    }
  });

  it("marks only archive destructive, never restore", () => {
    // Restore is an ordinary write; tinting it red would read as a second
    // destructive action on an archived row.
    expect(menu).toContain('actions.indexOf("archive")');
    expect(menu).not.toContain('actions.indexOf("restore")');
  });
});

describe("every key the new surface renders exists in both locales", () => {
  const en = JSON.parse(
    readFileSync(path.join(APP_ROOT, "lib/i18n/locales/en.json"), "utf8"),
  ) as Record<string, string>;
  const zh = JSON.parse(
    readFileSync(path.join(APP_ROOT, "lib/i18n/locales/zh.json"), "utf8"),
  ) as Record<string, string>;

  const NEW_KEYS = ["properties.actions.open"];

  for (const key of NEW_KEYS) {
    it(`${key} resolves in en and zh`, () => {
      expect(en[key], `en missing ${key}`).toBeTruthy();
      expect(zh[key], `zh missing ${key}`).toBeTruthy();
    });
  }

  it("matches web's wording for the trigger's a11y label", () => {
    // Verbatim from packages/views/locales/*/settings.json
    // (`properties.actions.open`).
    expect(zh["properties.actions.open"]).toBe("{{name}} 的操作");
    expect(en["properties.actions.open"]).toBe("Actions for {{name}}");
  });
});
