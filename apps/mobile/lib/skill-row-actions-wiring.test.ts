/**
 * Wiring ratchet for the skills-list row actions (iteration 230, MYS-2097).
 *
 * `lib/skill-row-actions.test.ts` proves the decisions answer correctly. None
 * of that reaches a user unless the LIST screen actually renders the kebab and
 * routes its choices to the real mutations — and the list screen is precisely
 * where the defect lived: the helpers could all exist and stay unused while
 * every row remained a bare `router.push` to the detail page, which is what the
 * BEFORE probe measured (0 kebab nodes, 0 `useRefreshSkill` references).
 *
 * Each assertion is therefore paired with its negative, because presence alone
 * passes on a file that kept the old path beside the new one:
 *
 *   1. the row hosts the shared menu, and it gives way to the checkbox in
 *      selection mode (one trailing control per row);
 *   2. the menu asks `skillRowActions` which items to show — not a second
 *      hand-rolled gate in JSX;
 *   3. the screen owns the writes, so the kebab and the batch bar cannot drift;
 *   4. refresh reuses the detail page's confirm copy verbatim, including the
 *      warning that local edits are overwritten;
 *   5. add-to-agent goes through the SHARED sheet, not a third copy;
 *   6. every locale key the new surface renders exists in both bundles.
 *
 * Mobile's vitest lane is Node-only (`vitest.config.ts`), so this is asserted
 * against source rather than rendered markup — the convention this repo already
 * uses for wiring (`autopilot-list-wiring.test.ts`, `run-confirm-wiring.test.ts`).
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

const LIST = "app/(app)/[workspace]/more/skills.tsx";
const ROW_MENU = "components/skill/skill-row-menu.tsx";
const SHEET = "components/skill/add-to-agents-sheet.tsx";
const BATCH_BAR = "components/skill/skill-batch-bar.tsx";

describe("the skills list exposes a row kebab", () => {
  const src = code(LIST);

  it("mounts the shared row menu on every rendered row", () => {
    expect(src).toContain("<SkillRowMenu");
    // …on the row item, not somewhere unreachable: the props it needs are
    // threaded from `renderItem`.
    expect(src).toContain("onAddToAgent={");
    expect(src).toContain("onRefresh={");
    expect(src).toContain("onDelete={");
  });

  it("keeps the kebab out of selection mode", () => {
    // One trailing control per row: picking is what the mode is for. A kebab
    // rendered unconditionally would sit next to the checkbox.
    const item = src.slice(src.indexOf("function SkillRowItem("));
    expect(item).toMatch(/\{selectionMode \? null : \(\s*<SkillRowMenu/);
  });

  it("owns the refresh and delete writes, so both entry points share them", () => {
    expect(src).toContain("useRefreshSkill()");
    expect(src).toContain("useDeleteSkill()");
    // The batch bar must NOT own its own refresh/delete pair — that is the fork
    // this split prevents (the bar reaches delete through the screen's copy).
    expect(code(BATCH_BAR)).not.toContain("useRefreshSkill");
  });

  it("routes the kebab's add-to-agent through the shared sheet", () => {
    // The screen's one `MultiSelectSheet` is `SkillFilterSheet` (the search /
    // sort / filter UI). A second one carrying the agent-picker copy would be a
    // third copy of that picker — the batch bar and the detail page hold the
    // other two.
    expect(src).toContain("<AddToAgentsSheet");
    expect(src).not.toContain("skills.usedBy.noAgents");
    expect(src).not.toContain("skills.usedBy.searchPlaceholder");
  });

  it("reuses the detail page's refresh confirm, warning included", () => {
    // The warning is the load-bearing half: a refresh overwrites SKILL.md and
    // the whole file set, so local edits do not survive. Dropping it would
    // describe the same irreversible action differently on two screens.
    expect(src).toContain("skills.detail.refreshConfirmTitle");
    expect(src).toContain("skills.detail.refreshConfirmBody");
    expect(src).toContain("skills.detail.refreshConfirmWarning");
    expect(src).toContain("refreshSkill.mutate(");
  });

  it("words a single-row delete with the singular sentence", () => {
    // Web's dialog branches on `rows.length === 1` for exactly this reason:
    // "Delete skill?" with the name beats "Delete 1 skills?".
    expect(src).toContain("skills.deleteTitle");
    expect(src).toContain("skills.deleteMessage");
    expect(src).toContain("deleteSkill.mutate(");
  });
});

describe("the row menu is a thin host over the shared decisions", () => {
  const menu = code(ROW_MENU);

  it("asks the shared helper which items to show", () => {
    expect(menu).toContain("skillRowActions(");
  });

  it("returns nothing rather than opening an empty sheet", () => {
    expect(menu).toMatch(/if \(actions\.length === 0\) return null;/);
  });

  it("does not write to the server itself", () => {
    // The mutations belong to the screen. A hook here is the fork this
    // prevents — and it would leave the batch bar on a second path.
    expect(menu).not.toContain("useRefreshSkill");
    expect(menu).not.toContain("useDeleteSkill");
    expect(menu).not.toContain("mutate");
  });

  it("routes each item to the callback the screen supplied", () => {
    for (const branch of ["onAddToAgent(row)", "onRefresh(row)", "onDelete(row)"]) {
      expect(menu).toContain(branch);
    }
  });
});

describe("one add-to-agent sheet serves the kebab and the batch bar", () => {
  it("is the implementation both list entry points import", () => {
    for (const file of [LIST, BATCH_BAR]) {
      expect(code(file), file).toContain("AddToAgentsSheet");
    }
  });

  it("keeps the already-bound filter and the attach plan in the sheet", () => {
    // `planSkillAttach` skips a target that already holds every selected skill,
    // so a fully-bound agent never produces a request. Inlining a plain
    // `agents.map(...)` in a caller re-creates the pointless write.
    const sheet = code(SHEET);
    expect(sheet).toContain("planSkillAttach(");
    expect(sheet).toContain("missingSkillIds(");
    expect(sheet).not.toMatch(/agents\.map\(/);
  });

  it("hands its directory state to the sheet", () => {
    // The `MultiSelectSheet` failure branch is only reachable when the caller
    // passes a resolved state; `catalog-wiring.test.ts` pins the same contract
    // for the sheet itself.
    const sheet = code(SHEET);
    expect(sheet).toContain("catalogRead(");
    expect(sheet).toMatch(/\bstate=\{/);
    expect(sheet).toMatch(/\bonRetry=\{/);
  });

  it("drops a pending selection when it closes", () => {
    // A kebab opened twice must not carry the first agent choice into the
    // second write.
    expect(code(SHEET)).toMatch(/if \(!visible\) setSelectedIds\(new Set\(\)\)/);
  });
});

describe("every key the new surface renders exists in both locales", () => {
  const en = JSON.parse(
    readFileSync(path.join(APP_ROOT, "lib/i18n/locales/en.json"), "utf8"),
  ) as Record<string, string>;
  const zh = JSON.parse(
    readFileSync(path.join(APP_ROOT, "lib/i18n/locales/zh.json"), "utf8"),
  ) as Record<string, string>;

  const NEW_KEYS = ["skills.actions.row_menu", "skills.actions.delete"];

  for (const key of NEW_KEYS) {
    it(`${key} resolves in en and zh`, () => {
      // A missing key renders as the raw id — barely enough to notice, and the
      // kind of thing a locale rewrite drops silently.
      expect(en[key], `en missing ${key}`).toBeTruthy();
      expect(zh[key], `zh missing ${key}`).toBeTruthy();
    });
  }

  it("matches web's zh wording for the copy a user reads", () => {
    // Verbatim from packages/views/locales/zh-Hans/skills.json, so a phone and
    // a desktop name the same action the same way.
    expect(zh["skills.actions.delete"]).toBe("删除");
    expect(zh["skills.actions.row_menu"]).toBe("操作");
  });
});
