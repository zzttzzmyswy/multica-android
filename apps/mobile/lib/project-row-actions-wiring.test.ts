// Source wiring checks (the mobile Vitest runner does not render native UI).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const SCREEN = "components/project/projects-screen.tsx";
const CARD_ROW = "components/project/project-row.tsx";
const ROW_MENU = "components/project/project-row-menu.tsx";
const DETAIL = "app/(app)/[workspace]/project/[id].tsx";

describe("the projects list exposes a card menu", () => {
  const src = code(SCREEN);

  it("threads the menu prop into the card list", () => {
    expect(src).toContain("menu={rowMenu}");
  });

  it("builds the menu with pin and permission information", () => {
    expect(src).toContain("const rowMenu = useMemo(");
    expect(src).toContain("pinnedIds: pinnedProjectIds");
    expect(src).toContain("pinsResolved: pinsRead.isResolved");
    expect(src).toContain("canDelete: isWorkspaceAdmin");
  });

  it("resolves the pin list's settlement rather than defaulting it to []", () => {
    // `const { data: pins = [] }` is the construct that makes an unresolved
    // read indistinguishable from "nothing is pinned" — and the kebab would
    // then offer 「置顶」 over an already-pinned project.
    expect(src).toContain("catalogRead(");
    expect(src).toMatch(/pinsResolved:\s*pinsRead\.isResolved/);
    expect(src).not.toMatch(/data:\s*pins\s*=\s*\[\]/);
  });

  it("routes both writes through the mutations the batch toolbar already owns", () => {
    // One write path per action: a second delete mutation here is how the kebab
    // and the long-press toolbar come to disagree about confirmation and about
    // restoring the list on failure.
    expect(src).toContain("const batchPin = useBatchPinToggle();");
    expect(src).toContain("const batchDelete = useBatchDeleteProjects();");
    expect(src).toContain("batchPin.unpin(project.id)");
    expect(src).toContain("batchPin.pin(project.id)");
    expect(src).toContain("batchDelete.mutate([project.id]");
    // …and no second delete path invented beside it. The negative is spelled
    // out rather than left to the hook import: `useDeleteProject` is bound to
    // one id at hook-construction time, so reaching for it here is exactly the
    // fork this prevents.
    expect(src).not.toContain("useDeleteProject");
    expect(src).not.toContain("deleteProject.mutate(");
  });

  it("gates delete on the same admin predicate the batch bar uses", () => {
    // `canDelete` must be the batch bar's own `isWorkspaceAdmin`, or the row
    // menu and the toolbar would disagree about who may delete.
    expect(src).toContain("isWorkspaceAdmin");
    expect(src.match(/canDelete: isWorkspaceAdmin/g) ?? []).toHaveLength(1);
  });

  it("asks before deleting, with the detail page's own copy", () => {
    // The issue text is the load-bearing half: it says the issues survive. A
    // shorter invented sentence would describe the same irreversible action
    // differently on two screens.
    expect(src).toContain("project.deleteTitle");
    expect(src).toContain("project.deleteMessage");
  });

  it("makes the confirm the only route to the write", () => {
    // The copy alone is passable by a file that renders the sentence and then
    // fires the write regardless — which is what a `destructiveButtonIndex`
    // mutation that only deletes the confirm's `onPress` looks like. So the
    // write must sit INSIDE the alert: `Alert.alert(` first, the mutate after,
    // in that order, within `confirmRowDelete`.
    const fnAt = src.indexOf("const confirmRowDelete = useCallback(");
    expect(fnAt).toBeGreaterThan(-1);
    const body = src.slice(fnAt, src.indexOf("const rowMenu = useMemo("));
    const alertAt = body.indexOf("Alert.alert(");
    const mutateAt = body.indexOf("batchDelete.mutate([project.id]");
    expect(alertAt).toBeGreaterThan(-1);
    expect(mutateAt).toBeGreaterThan(alertAt);
    // The mutate is handed to the destructive button's `onPress`, so dismissing
    // the dialog (or tapping Cancel) cannot reach it.
    expect(body).toContain("style: \"destructive\"");
    expect(body).toMatch(/style:\s*"destructive",\s*\n\s*onPress:/);
  });

  it("reports a failed row delete rather than swallowing it", () => {
    // `useBatchDeleteProjects` has no `meta` failure title (see
    // write-wiring.test.ts), so its call site must alert.
    expect(src).toContain("project.deleteFailed");
    expect(src).toContain("common.unknownError");
  });
});

describe("the project card hosts the menu", () => {
  it("renders the menu outside selection mode", () => {
    const row = code(CARD_ROW);
    expect(row).toContain("<ProjectRowMenu");
    expect(row).toContain("menu && !selectionMode");
  });
});

describe("the row menu is a thin host over the shared decisions", () => {
  const menu = code(ROW_MENU);

  it("asks the shared helper which items to show", () => {
    expect(menu).toContain("projectRowActionsFor(");
  });

  it("returns nothing rather than opening an empty sheet", () => {
    expect(menu).toMatch(/if \(actions\.length === 0\) return null;/);
  });

  it("does not write to the server itself", () => {
    // The mutations belong to the screen. A hook here is the fork this
    // prevents — and it would leave the batch toolbar on a second path.
    expect(menu).not.toContain("useBatchDeleteProjects");
    expect(menu).not.toContain("useBatchPinToggle");
    expect(menu).not.toContain("mutate");
  });

  it("routes each item to the callback the screen supplied", () => {
    expect(menu).toContain("onTogglePin(project,");
    expect(menu).toContain("onDelete(project)");
  });

  it("marks delete destructive so the red option is last under the thumb", () => {
    // Asserted on the DERIVATION as well as the spread: a file can name the
    // variable and then pass `destructiveButtonIndex: -1` (or drop the spread
    // from the options object entirely), leaving a plain-coloured delete that
    // reads like every other entry.
    expect(menu).toContain('const destructiveButtonIndex = actions.indexOf("delete");');
    expect(menu).toContain("...(destructiveButtonIndex >= 0 ? { destructiveButtonIndex } : {})");
  });

  it("omits web's open_in_new_tab, which has no phone meaning", () => {
    // The row tap already opens the project; a second entry for the same
    // navigation is what the sibling menus all dropped.
    expect(menu).not.toContain("open_in_new_tab");
    expect(menu).not.toContain("issue.openWeb");
  });
});

describe("the projects row menu reuses the detail page's delete confirm", () => {
  it("renders the same two keys the detail page renders", () => {
    // Two entry points to one write; if the keys move, both must move.
    const detail = code(DETAIL);
    for (const key of ["project.deleteTitle", "project.deleteMessage"]) {
      expect(detail, `detail no longer renders ${key}`).toContain(key);
      expect(code(SCREEN), `list does not render ${key}`).toContain(key);
    }
  });
});

describe("every key the new surface renders exists in both locales", () => {
  const en = JSON.parse(
    readFileSync(path.join(APP_ROOT, "lib/i18n/locales/en.json"), "utf8"),
  ) as Record<string, string>;
  const zh = JSON.parse(
    readFileSync(path.join(APP_ROOT, "lib/i18n/locales/zh.json"), "utf8"),
  ) as Record<string, string>;

  const NEW_KEYS = ["projects.rowMenu"];

  for (const key of NEW_KEYS) {
    it(`${key} resolves in en and zh`, () => {
      // A missing key renders as the raw id — barely enough to notice, and the
      // kind of thing a locale rewrite drops silently.
      expect(en[key], `en missing ${key}`).toBeTruthy();
      expect(zh[key], `zh missing ${key}`).toBeTruthy();
    });
  }

  it("matches web's wording for the trigger's a11y label", () => {
    // Verbatim from packages/views/locales/{en,zh-Hans}/projects.json
    // (`page.row_menu`), so a phone and a desktop name the same control the
    // same way.
    expect(en["projects.rowMenu"]).toBe("Project actions");
    expect(zh["projects.rowMenu"]).toBe("项目操作");
  });

  it("keeps the pin verbs the menu renders present in both bundles", () => {
    // The menu resolves its labels through PROJECT_ROW_ACTION_LABEL_KEY; a
    // locale rewrite that dropped either verb would render a raw key onto the
    // sheet.
    for (const key of ["projects.pin", "projects.unpin", "projects.batchDelete"]) {
      expect(en[key], `en missing ${key}`).toBeTruthy();
      expect(zh[key], `zh missing ${key}`).toBeTruthy();
    }
  });
});
