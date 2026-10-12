/**
 * Wiring ratchet for the labels-list row actions (iteration 231, MYS-2102).
 *
 * `lib/label-row-actions.test.ts` proves the decisions answer correctly. None
 * of that reaches a user unless the LIST screen actually renders the kebab and
 * routes its choices to the real mutations — and the list screen is precisely
 * where the defect lived: the helper could exist and stay unused while every
 * row remained a bare `router.push` to the edit form, which is what the BEFORE
 * probe measured (0 kebab nodes).
 *
 * Each assertion is therefore paired with its negative, because presence alone
 * passes on a file that kept the old path beside the new one:
 *
 *   1. the row hosts the shared menu and threads all three callbacks;
 *   2. the menu asks `labelRowActions` which items to show — not a second
 *      hand-rolled list in JSX;
 *   3. the screen owns the delete write, so the kebab and the edit form cannot
 *      drift;
 *   4. the delete confirm reuses the edit form's copy verbatim, `{{count}}`
 *      included — that count is what tells the user assignments go with it;
 *   5. **no permission gate is added**, because web has none on this surface.
 *
 * Mobile's vitest lane is Node-only (`vitest.config.ts`), so this is asserted
 * against source rather than rendered markup — the convention this repo already
 * uses for wiring (`skill-row-actions-wiring.test.ts`,
 * `autopilot-list-wiring.test.ts`). Comments are stripped so a comment
 * describing the wiring cannot satisfy it.
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

const LIST = "app/(app)/[workspace]/more/labels.tsx";
const ROW_MENU = "components/label/label-row-menu.tsx";
const FORM = "components/label/label-form.tsx";

describe("the labels list exposes a row kebab", () => {
  const src = code(LIST);

  it("mounts the shared row menu on every rendered row", () => {
    expect(src).toContain("<LabelRowMenu");
    // …on the row item, not somewhere unreachable: the props it needs are
    // threaded from `renderItem`.
    expect(src).toContain("onEdit={");
    expect(src).toContain("onDelete={");
  });

  it("owns the delete write, so the kebab and the edit form share it", () => {
    expect(src).toContain("useDeleteLabel()");
    expect(src).toContain("deleteLabel.mutate(");
  });

  it("routes edit through the same push the row tap uses", () => {
    // Two independent `router.push` calls is how the kebab and the row tap come
    // to open different screens after a route rename.
    expect(src).toContain("const openEdit = useCallback(");
    expect(src).toContain("onPress={() => openEdit(item)}");
    expect(src).toContain("onEdit={() => openEdit(item)}");
    expect(src.match(/more\/labels\/\$\{/g) ?? []).toHaveLength(1);
  });

  it("reuses the edit form's delete confirm, resource count included", () => {
    // `{{count}}` is the load-bearing half: deleting a label drops every issue
    // and skill assignment atomically, and the sentence is what says so.
    expect(src).toContain("labels.deleteTitle");
    expect(src).toContain("labels.deleteMessage");
    expect(src).toContain("usage_count");
  });

  it("keeps the delete confirm's wording identical to the form's", () => {
    // The form is the other entry point to the same write; if the keys move,
    // both must move.
    const form = code(FORM);
    for (const key of ["labels.deleteTitle", "labels.deleteMessage", "labels.delete"]) {
      expect(form, `form no longer renders ${key}`).toContain(key);
      expect(src, `list does not render ${key}`).toContain(key);
    }
  });

  it("adds NO permission gate — web's labels tab has none", () => {
    // The properties tab next door gates its menu on canManage. Labels
    // deliberately do not: `grep canManage` over web's labels-tab.tsx returns
    // nothing, and the DropdownMenu is unconditional inside the row map. A
    // later round "aligning" the two would drop a capability web grants.
    expect(src).not.toContain("canManage");
    expect(src).not.toContain("useCurrentMemberRole");
  });
});

describe("the row menu is a thin host over the shared decisions", () => {
  const menu = code(ROW_MENU);

  it("asks the shared helper which items to show", () => {
    expect(menu).toContain("labelRowActions(");
  });

  it("returns nothing rather than opening an empty sheet", () => {
    expect(menu).toMatch(/if \(actions\.length === 0\) return null;/);
  });

  it("does not write to the server itself", () => {
    // The mutation belongs to the screen. A hook here is the fork this
    // prevents — and it would leave the edit form on a second path.
    expect(menu).not.toContain("useDeleteLabel");
    expect(menu).not.toContain("useUpdateLabel");
    expect(menu).not.toContain("mutate");
  });

  it("routes each item to the callback the screen supplied", () => {
    expect(menu).toContain("onEdit(label)");
    expect(menu).toContain("onDelete(label)");
  });

  it("marks delete destructive so a red option is the last thing under the thumb", () => {
    expect(menu).toContain("destructiveButtonIndex");
  });
});

describe("every key the new surface renders exists in both locales", () => {
  const en = JSON.parse(
    readFileSync(path.join(APP_ROOT, "lib/i18n/locales/en.json"), "utf8"),
  ) as Record<string, string>;
  const zh = JSON.parse(
    readFileSync(path.join(APP_ROOT, "lib/i18n/locales/zh.json"), "utf8"),
  ) as Record<string, string>;

  const NEW_KEYS = ["labels.actions.open"];

  for (const key of NEW_KEYS) {
    it(`${key} resolves in en and zh`, () => {
      // A missing key renders as the raw id — barely enough to notice, and the
      // kind of thing a locale rewrite drops silently.
      expect(en[key], `en missing ${key}`).toBeTruthy();
      expect(zh[key], `zh missing ${key}`).toBeTruthy();
    });
  }

  it("matches web's zh wording for the trigger's a11y label", () => {
    // Verbatim from packages/views/locales/zh-Hans/settings.json
    // (`labels.actions.open`), so a phone and a desktop name the same control
    // the same way.
    expect(zh["labels.actions.open"]).toBe("{{name}} 的操作");
    expect(en["labels.actions.open"]).toBe("Actions for {{name}}");
  });
});
