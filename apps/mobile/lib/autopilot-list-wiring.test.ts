/**
 * Wiring ratchet for the autopilots-list row actions and batch toolbar
 * (iteration 229, MYS-2096).
 *
 * `lib/autopilot-list-actions.test.ts` proves the decisions answer correctly.
 * None of that reaches a user unless the LIST screen actually calls them — and
 * the list screen is precisely where the defect lived: every one of those
 * helpers could have existed and stayed unused while the row remained a bare
 * `router.push` to the detail page.
 *
 * This file is therefore about WIRING, and each assertion is paired with its
 * negative, because presence alone passes on a file that kept the old path
 * beside the new one:
 *
 *   1. the row hosts the kebab and the checkbox, and a row tap in selection
 *      mode toggles instead of navigating;
 *   2. the kebab's gate is the shared helper — not a second `can_write` test
 *      invented in JSX;
 *   3. the batch bar's status write goes through `autopilotStatusPlan`, so the
 *      "skip rows already in the target status" rule cannot be dropped by
 *      inlining a plain `rows.map`;
 *   4. the delete confirm is ONE dialog shared by both entry points, and it
 *      loops the rows one request at a time as web does;
 *   5. every locale key the new surface renders exists in both bundles.
 *
 * Mobile's vitest lane is Node-only (`vitest.config.ts`), so this is asserted
 * against source rather than rendered markup — the convention this repo already
 * uses for wiring (`deliverables-wiring.test.ts`, `run-confirm-wiring.test.ts`).
 * Comments are stripped so a comment describing the wiring cannot satisfy it.
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

const LIST = "app/(app)/[workspace]/more/autopilots.tsx";
const ROW_MENU = "components/autopilot/autopilot-row-menu.tsx";
const BATCH_BAR = "components/autopilot/autopilot-batch-bar.tsx";
const DELETE_DIALOG = "components/autopilot/delete-autopilots-dialog.tsx";

describe("the list exposes a row kebab and a selection mode", () => {
  const src = code(LIST);

  it("mounts the shared row menu on every rendered row", () => {
    expect(src).toContain("<AutopilotRowMenu");
  });

  it("mounts the batch bar and the delete dialog", () => {
    expect(src).toContain("<AutopilotBatchBar");
    expect(src).toContain("<DeleteAutopilotsDialog");
  });

  it("gates the kebab with the shared helper, not a second can_write test", () => {
    // The rule is `can_write !== false` (absent = allowed, the backend is the
    // gate). An inlined `=== true` here would hide the menu from every member
    // on an older server, which is the opposite of web's behaviour.
    expect(src).toContain("canWriteAutopilot(");
    expect(src).not.toMatch(/can_write\s*===?\s*true/);
  });

  it("routes the batch status write through the skip-already-matching plan", () => {
    // Inlining `selectedRows.map(row => update(row.id, status))` would PATCH
    // every row to a status it may already hold — web skips those.
    expect(src).toContain("autopilotStatusPlan(");
    expect(src).not.toMatch(/selectedRows\.(map|forEach)\(/);
  });

  it("toggles a row instead of navigating while selecting", () => {
    // The pre-iteration shape pushed the detail route from every row tap,
    // unconditionally. It must now sit behind the mode check.
    const renderItem = src.slice(src.indexOf("renderItem={"));
    const body = renderItem.slice(0, renderItem.indexOf("ListEmptyComponent"));
    expect(body).toContain("if (selectionMode) toggleRow(item.id);");
    expect(body).toMatch(/router\.push\(`\/\$\{wsSlug\}\/more\/autopilots\/\$\{item\.id\}`\)/);
  });

  it("uses the shared selection helpers rather than a private state machine", () => {
    // `toggleId` / `toggleSelectAllVisible` live in lib/skill-batch.ts and are
    // what the skills list already uses. A second implementation is how the two
    // lists would come to disagree about what select-all means.
    expect(src).toContain("toggleId(");
    expect(src).toContain("toggleSelectAllVisible(");
  });

  it("keeps the batch bar's room in the list padding", () => {
    // A floating bar over the last row makes that row untappable; the skills
    // list reserves the same 132pt.
    expect(src).toMatch(/selectionMode && selectedRows\.length > 0 \? 132 : 24/);
  });
});

describe("the row menu is a thin host over the shared decisions", () => {
  const menu = code(ROW_MENU);

  it("asks the shared helper which items to show", () => {
    expect(menu).toContain("autopilotRowActions(");
  });

  it("returns nothing rather than opening an empty sheet", () => {
    expect(menu).toMatch(/if \(actions\.length === 0\) return null;/);
  });

  it("does not write to the server itself", () => {
    // The mutations belong to the screen, so the kebab and the batch bar share
    // one optimistic path. A mutation hook here is the fork this prevents.
    expect(menu).not.toContain("useUpdateAutopilot");
    expect(menu).not.toContain("useDeleteAutopilot");
    expect(menu).not.toContain("mutate");
  });
});

describe("the batch bar adapts its buttons to the selection", () => {
  const bar = code(BATCH_BAR);

  it("asks the shared helper which status buttons to show", () => {
    expect(bar).toContain("autopilotBatchActions(");
  });

  it("renders both status buttons behind that verdict", () => {
    // `actions.pause ? … : null` and the resume twin: an unconditional pair
    // would offer "pause" for an all-paused selection, whose plan is empty and
    // which would therefore do nothing at all.
    expect(bar).toMatch(/\{actions\.pause \?/);
    expect(bar).toMatch(/\{actions\.resume \?/);
  });

  it("does not write to the server itself", () => {
    expect(bar).not.toContain("useUpdateAutopilot");
    expect(bar).not.toContain("useDeleteAutopilot");
  });
});

describe("one delete dialog serves both entry points", () => {
  it("is imported by the screen only, and hosts the shared copy", () => {
    const dialog = code(DELETE_DIALOG);
    // Every copy line comes from web's `actions.delete_dialog.*` family.
    for (const key of [
      "title",
      "descriptionOne",
      "descriptionOther",
      "warning",
      "cancel",
      "confirm",
      "deleting",
    ]) {
      expect(dialog).toContain(`autopilots.actions.delete_dialog.${key}`);
    }
  });

  it("keeps the dialog open while the loop runs", () => {
    // Web awaits the loop before closing (`:58-66`); closing on the first frame
    // would leave a half-deleted batch with nothing on screen.
    const dialog = code(DELETE_DIALOG);
    expect(dialog).toMatch(/await onConfirm\(\);\s*\n\s*onClose\(\);/);
  });

  it("switches to the singular sentence for a one-row selection", () => {
    const dialog = code(DELETE_DIALOG);
    expect(dialog).toMatch(/rows\.length === 1/);
  });

  it("clears the selection only for the batch entry point", () => {
    // Web passes the dialog's `onDeleted` from the toolbar alone
    // (`autopilot-list-actions.tsx:279`) and not from the kebab (`:203`): a
    // row deleted from its own menu has nothing to do with whatever else
    // happens to be selected, and dropping the selection there would throw
    // away a batch the user was still assembling.
    const src = code(LIST);
    expect(src).toMatch(/openDelete\(\[row\], false\)/);
    expect(src).toMatch(/openDelete\(\[\.\.\.selectedRows\], true\)/);
    // …and the flag is what gates the clear, not an unconditional call.
    expect(src).toMatch(/if \(pending\?\.batch\) exitSelection\(\);/);
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
    "autopilots.actions.row_menu",
    "autopilots.actions.pause",
    "autopilots.actions.resume",
    "autopilots.actions.delete",
    "autopilots.actions.selected",
    "autopilots.actions.clear_selection",
    "autopilots.actions.delete_dialog.title",
    "autopilots.actions.delete_dialog.descriptionOne",
    "autopilots.actions.delete_dialog.descriptionOther",
    "autopilots.actions.delete_dialog.warning",
    "autopilots.actions.delete_dialog.cancel",
    "autopilots.actions.delete_dialog.confirm",
    "autopilots.actions.delete_dialog.deleting",
    "autopilots.list.enterSelection",
    "autopilots.list.exitSelection",
    "autopilots.list.selectOne",
  ];

  for (const key of NEW_KEYS) {
    it(`${key} resolves in en and zh`, () => {
      // A missing key renders as the raw id — barely enough to notice, and the
      // kind of thing a locale rewrite drops silently.
      expect(en[key], `en missing ${key}`).toBeTruthy();
      expect(zh[key], `zh missing ${key}`).toBeTruthy();
    });
  }

  it("matches web's zh wording for the copy a user reads", () => {
    // Verbatim from packages/views/locales/zh-Hans/autopilots.json, so a phone
    // and a desktop describe the same irreversible action in the same words.
    expect(zh["autopilots.actions.pause"]).toBe("暂停");
    expect(zh["autopilots.actions.resume"]).toBe("恢复");
    expect(zh["autopilots.actions.delete"]).toBe("删除");
    expect(zh["autopilots.actions.row_menu"]).toBe("自动化操作");
    expect(zh["autopilots.actions.clear_selection"]).toBe("清除选择");
    expect(zh["autopilots.actions.delete_dialog.title"]).toBe("删除自动化？");
    expect(zh["autopilots.actions.delete_dialog.confirm"]).toBe("永久删除");
    expect(zh["autopilots.actions.delete_dialog.warning"]).toBe(
      "此操作无法撤销。",
    );
  });

  it("keeps the count placeholder in the plural sentence", () => {
    // A dropped {{count}} silently turns "3 automations" into a fixed phrase.
    expect(en["autopilots.actions.delete_dialog.descriptionOther"]).toContain(
      "{{count}}",
    );
    expect(zh["autopilots.actions.delete_dialog.descriptionOther"]).toContain(
      "{{count}}",
    );
    expect(en["autopilots.actions.selected"]).toContain("{{count}}");
    expect(zh["autopilots.actions.selected"]).toContain("{{count}}");
    // …and the singular one names the autopilot.
    expect(en["autopilots.actions.delete_dialog.descriptionOne"]).toContain(
      "{{name}}",
    );
    expect(zh["autopilots.actions.delete_dialog.descriptionOne"]).toContain(
      "{{name}}",
    );
  });
});
