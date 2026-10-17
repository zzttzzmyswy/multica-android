/**
 * Wiring ratchet for the projects-list inline editors (iteration 253,
 * MYS-2202).
 *
 * `lib/project-inline-edit.test.ts` proves the decisions answer correctly. None
 * of that reaches a user unless the two list views actually render the cells
 * and route their writes to the real mutation — and this list is precisely
 * where the gap lived: both views rendered status, priority and lead as static
 * text, so changing any of the three meant opening the project first. The
 * helper existing and staying unused is exactly the failure this file catches.
 *
 * Each assertion is paired with its negative, because presence alone passes on
 * a file that kept the old static cell beside the new control:
 *
 *   1. BOTH views host the cells — the table is `viewMode`'s default, so a
 *      card-only editor would be invisible on a cold open;
 *   2. the screen owns the write path and the sheet, once, so the two views
 *      cannot drift on which mutation they call or on what the sheet contains;
 *   3. the sheet hosts the same picker bodies the detail page's routes use —
 *      not a second set of options;
 *   4. the old static cells are gone from both views;
 *   5. the lead cell does not assert an absence from an unanswered read;
 *   6. every locale key the new surface renders exists in both bundles.
 *
 * Mobile's vitest lane is Node-only (`vitest.config.ts`), so this is asserted
 * against source rather than rendered markup — the convention this repo already
 * uses for wiring (`project-row-actions-wiring.test.ts`,
 * `skill-row-actions-wiring.test.ts`). Comments are stripped so a comment
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

const SCREEN = "components/project/projects-screen.tsx";
const CARD_ROW = "components/project/project-row.tsx";
const TABLE_ROW = "components/project/project-table-view.tsx";
const CELLS = "components/project/project-inline-cells.tsx";
const EDITOR = "components/project/project-cell-editor.tsx";
const DETAIL_PICKER = "app/(app)/[workspace]/project/[id]/picker/lead.tsx";

describe("both projects views edit status / priority / lead in place", () => {
  const screen = code(SCREEN);

  it("threads one shared edit prop into both the table and the card list", () => {
    // The table is `viewMode`'s DEFAULT, so a card-only editor would leave the
    // feature invisible on a cold open — the same trap the row kebab's own
    // wiring test pins one iteration earlier.
    //
    // Asserted per VIEW rather than on the file: `toContain` on the whole
    // screen passes while either half is missing, which is precisely the
    // half-defect this pins (found by mutation 2 of
    // `scripts/falsify-iter253-project-inline-edit.py`).
    const tableBlock = screen.slice(
      screen.indexOf("<ProjectTableView"),
      screen.indexOf("<FlatList", screen.indexOf("<ProjectTableView")),
    );
    expect(tableBlock).toContain("inlineEdit={inlineEdit}");
    const cardBlock = screen.slice(
      screen.indexOf("<ProjectRow\n"),
      screen.indexOf("</ProjectRow>", screen.indexOf("<ProjectRow\n")),
    );
    expect(cardBlock).toContain("inlineEdit={inlineEdit}");
  });

  it("builds that prop once, so the two views cannot diverge", () => {
    expect(screen).toContain("const inlineEdit = useMemo(");
    expect(screen).toMatch(/onEdit:\s*openCellEditor/);
    // Selection mode travels WITH the prop: the table takes the screen's flag
    // and the card takes its own prop, so mixing it in here is what keeps one
    // rule (`projectCellIsEditable`) true on both.
    expect(screen).toMatch(/inlineEdit = useMemo\(\s*\(\) => \(\{ onEdit: openCellEditor, selectionMode \}/);
  });

  it("renders one editor sheet for the whole list", () => {
    // Per row would remount it on every list re-render, and two mount points is
    // how the table and the card come to open different sheets.
    expect(screen.match(/<ProjectCellEditor/g) ?? []).toHaveLength(1);
  });

  it("re-derives the open target from the live list", () => {
    // A write that lands while the sheet is open must be visible in it, and a
    // project filtered or deleted out from under it must close it rather than
    // edit a stale row.
    expect(screen).toMatch(/visible\.find\(\(p\) => p\.id === cellKey\.projectId\)/);
    expect(screen).toContain("}, [cellKey, visible]);");
  });

  it("lets the cells give way in multi-select, like the row kebab", () => {
    // The rule: `projectCellIsEditable` returns false while selection mode is
    // on. Both views have to feed it the flag.
    //
    // The card's `selectionMode` is a prop with a default, so the row folds it
    // into the edit prop it hands down instead of asking the cell to know.
    expect(code(CARD_ROW)).toMatch(/cellEdit[\s\S]{0,160}selectionMode/);
    // The table takes the screen's flag inside the shared prop it was handed,
    // so the mixing happens once rather than in each view's render loop.
    expect(screen).toMatch(
      /inlineEdit = useMemo\(\s*\(\) => \(\{ onEdit: openCellEditor, selectionMode \}/,
    );
  });
});

describe("the row cells host the editors in both views", () => {
  it("the card renders all three as controls, each with the write path", () => {
    const card = code(CARD_ROW);
    for (const cell of ["ProjectStatusCell", "ProjectPriorityCell", "ProjectLeadCell"]) {
      expect(card, `card missing ${cell}`).toContain(`<${cell}`);
    }
    // One `edit={cellEdit}` per cell. Presence of the component alone passes on
    // a card that renders three static chips under the new names — which is the
    // pre-253 rendering wearing this round's identifiers.
    expect(card.match(/edit=\{cellEdit\}/g) ?? []).toHaveLength(3);
  });

  it("the table renders all three, status in the pinned pane", () => {
    const table = code(TABLE_ROW);
    for (const cell of ["ProjectStatusCell", "ProjectPriorityCell", "ProjectLeadCell"]) {
      expect(table, `table missing ${cell}`).toContain(`<${cell}`);
    }
    // Status is pinned with the title (web's non-hideable core column), so the
    // pinned pane has to host its editor — otherwise changing a status would
    // require panning the column strip into view first. Both halves matter: the
    // cell being there, and it being handed the write path.
    const pinnedBlock = table.slice(
      table.indexOf("if (pinned) {"),
      table.indexOf("return (\n      <Pressable", table.indexOf("if (pinned) {")),
    );
    expect(pinnedBlock).toContain("<ProjectStatusCell");
    expect(pinnedBlock).toContain("edit={inlineEdit}");
  });

  it("does not keep the old static cells beside the new ones", () => {
    // Both of these are the pre-253 rendering. Leaving either in place would
    // paint a second, uneditable copy of a field the row can now change.
    const card = code(CARD_ROW);
    expect(card).not.toContain("projectStatusLabel(project.status)");
    expect(card).not.toContain("projectPriorityLabel(project.priority)");
    const table = code(TABLE_ROW);
    expect(table).not.toContain("ProjectPriorityIcon");
    // The pinned status line was `ProjectStatusIcon` + `projectStatusLabel`;
    // the icon still imports for… nothing else in this file, so it must go too.
    expect(table).not.toContain("projectStatusLabel(item.status)");
  });

  it("makes each cell its own tap target so the row tap still navigates", () => {
    // Requirement 4 of the iteration: the in-row entry must not steal the row's
    // default click. RN gives the innermost responder the touch — the mechanism
    // the row kebab already relies on — so the cell has to BE a Pressable
    // nested inside the row's.
    const cells = code(CELLS);
    expect(cells).toContain("accessibilityRole=\"button\"");
    expect(cells).toContain('t("a11y.tableEditCell"');
    // …and the non-editable path is a plain View, so a host without a write
    // path renders text rather than a dead control.
    expect(cells).toMatch(/if \(!onPress\) \{[\s\S]{0,120}<View/);
  });

  it("keeps the em dash for a project with no priority, and keeps it tappable", () => {
    // `none` is a real value, not a missing one — and the project with no
    // priority is exactly the one a user wants to give one.
    const cells = code(CELLS);
    const priority = cells.slice(
      cells.indexOf("export function ProjectPriorityCell"),
      cells.indexOf("export function ProjectLeadCell"),
    );
    expect(priority).toContain("—");
    // The em dash sits INSIDE the tap target, not beside it: a cell that
    // rendered the dash outside `CellPress` would be dead on exactly the rows
    // that most need the editor.
    const pressAt = priority.indexOf("<CellPress");
    const dashAt = priority.indexOf("—");
    const closeAt = priority.indexOf("</CellPress>");
    expect(pressAt).toBeGreaterThan(-1);
    expect(dashAt).toBeGreaterThan(pressAt);
    expect(dashAt).toBeLessThan(closeAt);
  });
});

describe("the lead cell does not state what it has not read", () => {
  const cells = code(CELLS);

  it("reads its three states from the tested helper", () => {
    expect(cells).toContain("projectLeadCell(");
    expect(cells).toContain("catalogsResolved: resolved");
    expect(cells).toContain("resolveName: getName");
  });

  it("takes the resolution flag from the shared actor lookup", () => {
    // `useActorLookup().resolved` is the whole gate. Reading `getName`'s
    // fallback for emptiness instead — `?? t("picker.unassigned")` — is the
    // shape that says 「无负责人」 over a project that has a lead.
    expect(cells).toMatch(/const \{ getName, resolved \} = useActorLookup\(\)/);
    expect(cells).not.toMatch(/picker\.unassigned/);
  });

  it("derives the flag from BOTH directories a lead can point at", () => {
    // A lead is a member or an agent (`Project.lead_type`). Reporting
    // "resolved" off the member read alone paints the empty sentence over a
    // project whose lead is an agent whose directory has not arrived — the
    // whole defect, one directory narrower.
    const lookup = code("data/use-actor-name.ts");
    expect(lookup).toMatch(
      /const resolved = membersRead\.isResolved && agentsRead\.isResolved;/,
    );
    // …and never a constant, which is the same lie with nothing to wait for.
    expect(lookup).not.toMatch(/const resolved = true;/);
  });

  it("renders nothing at all in the pending state", () => {
    // Not the empty sentence, not a dashed placeholder — an empty cell claims
    // nothing, which is the only honest rendering for "the roster has not
    // arrived". A `—` here would read as "no lead", which is the assertion this
    // state exists to withhold.
    const lead = cells.slice(cells.indexOf("export function ProjectLeadCell"));
    expect(lead).toMatch(/if \(cell\.kind === "pending"\) return null;/);
  });

  it("renders the settled absence and the settled name", () => {
    const lead = cells.slice(cells.indexOf("export function ProjectLeadCell"));
    expect(lead).toContain('t("projects.leadNone")');
    expect(lead).toContain('cell.kind === "name" ? cell.name');
  });
});

describe("the editor sheet is a thin host over the shared picker bodies", () => {
  const editor = code(EDITOR);

  it("mounts the same bodies the detail page's routes mount", () => {
    // Same options, same order, same optimistic write — the point of reusing
    // the bodies instead of writing a second set of rows. The detail routes are
    // the parity target, so each body is asserted on both sides: what the sheet
    // renders and what the route that already rendered it renders.
    const pairs: [string, string][] = [
      ["ProjectStatusPickerBody", "picker/status.tsx"],
      ["ProjectPriorityPickerBody", "picker/priority.tsx"],
      ["ProjectLeadPickerBody", "picker/lead.tsx"],
    ];
    for (const [body, route] of pairs) {
      expect(editor, `editor missing ${body}`).toContain(`<${body}`);
      expect(
        code(`app/(app)/[workspace]/project/[id]/${route}`),
        `detail route ${route} no longer mounts ${body}`,
      ).toContain(`<${body}`);
    }
  });

  it("writes through the shared useUpdateProject, not a second mutation", () => {
    // One write path: this is what makes the in-row edit optimistically patch
    // the same caches the detail page does, and what gives it the failure title
    // the app-wide alert reads.
    expect(editor).toContain("useUpdateProject(projectId)");
    expect(editor).toContain("updateProject.mutate(patch)");
    expect(editor).not.toContain("api.updateProject");
  });

  it("closes the sheet before the write, so it never outlives the tap", () => {
    const commitAt = editor.indexOf("const commit = (patch: UpdateProjectRequest) => {");
    expect(commitAt).toBeGreaterThan(-1);
    const body = editor.slice(commitAt, editor.indexOf("};", commitAt));
    expect(body.indexOf("onClose()")).toBeLessThan(body.indexOf(".mutate("));
  });

  it("routes a lead pick through the shared patch helper", () => {
    // `{ lead_type, lead_id }` written by hand here is how the clear-to-null
    // case comes to send a half-set pair.
    expect(editor).toContain("leadUpdatePatch(next)");
    expect(editor).toContain("leadValueOf(target.project)");
  });

  it("sizes the lead sheet to fill and leaves the short lists content-sized", () => {
    // The lead body is a `flex-1` FlatList, which resolves to zero height in a
    // content-sized parent (the bug `picker-sheet.tsx` documents); status and
    // priority are plain ScrollViews and must not float in a tall sheet.
    expect(editor).toContain('const fill = target.column === "lead";');
    expect(editor).toContain("fill={fill}");
  });

  it("clears a stale search between cells", () => {
    expect(editor).toMatch(/setQuery\(""\);\s*\}, \[target\?\.project\.id, target\?\.column\]\)/);
  });

  it("names its search box the way the detail sheet names its own", () => {
    const detail = code(DETAIL_PICKER);
    expect(detail).toContain("picker.searchMembersOrAgents");
    expect(editor).toContain('t("picker.searchMembersOrAgents")');
  });

  it("hosts the searchable body in the shared shell, not a local copy", () => {
    expect(editor).toContain("<SearchablePickerBody");
    // The issue table's editor had the same shell inline; two copies is how one
    // control becomes two controls.
    expect(code("components/issue/table-cell-editor.tsx")).toContain(
      "<SearchablePickerBody",
    );
    expect(code(CELLS)).not.toContain("function SearchablePickerBody");
  });
});

describe("the actor lookup reports whether its directories answered", () => {
  const lookup = code("data/use-actor-name.ts");

  it("derives the flag from both directories a lead can point at", () => {
    // Member and agent — the two `Project.lead_type` values. Squads are
    // deliberately out: no project lead is ever a squad, so requiring that read
    // would make the cell wait on data it cannot use.
    expect(lookup).toMatch(
      /const resolved = membersRead\.isResolved && agentsRead\.isResolved;/,
    );
    expect(lookup).toContain("catalogRead(");
  });

  it("returns it beside the existing helpers", () => {
    expect(lookup).toMatch(/return \{ getName, getAvatarUrl, resolved \};/);
  });

  it("does not default the directories to [] again", () => {
    // `const { data: members = [] }` is the construct that folds "not loaded"
    // into "empty" — the whole reason `catalogRead` exists.
    expect(lookup).not.toMatch(/data: members = \[\]/);
    expect(lookup).not.toMatch(/data: agents = \[\]/);
  });
});

describe("every key the new surface renders exists in both locales", () => {
  const en = JSON.parse(
    readFileSync(path.join(APP_ROOT, "lib/i18n/locales/en.json"), "utf8"),
  ) as Record<string, string>;
  const zh = JSON.parse(
    readFileSync(path.join(APP_ROOT, "lib/i18n/locales/zh.json"), "utf8"),
  ) as Record<string, string>;

  const NEW_KEYS = ["projects.leadNone", "projects.leadPending"];

  for (const key of NEW_KEYS) {
    it(`${key} resolves in en and zh`, () => {
      // A missing key renders as the raw id — barely enough to notice, and the
      // kind of thing a locale rewrite drops silently.
      expect(en[key], `en missing ${key}`).toBeTruthy();
      expect(zh[key], `zh missing ${key}`).toBeTruthy();
      expect(en[key]).not.toBe(key);
      expect(zh[key]).not.toBe(key);
    });
  }

  it("matches web's wording for the empty lead", () => {
    // Verbatim from packages/views/locales/{en,zh-Hans}/projects.json
    // (`lead.no_lead`), so the phone and a desktop name the same state the same
    // way.
    expect(en["projects.leadNone"]).toBe("No lead");
    expect(zh["projects.leadNone"]).toBe("无负责人");
  });

  it("keeps the two lead states distinct in both languages", () => {
    // The whole point of the pair: a locale rewrite that collapsed them would
    // put the cell back to asserting an absence it never read.
    expect(en["projects.leadPending"]).not.toBe(en["projects.leadNone"]);
    expect(zh["projects.leadPending"]).not.toBe(zh["projects.leadNone"]);
  });

  it("keeps the column headings the sheet titles come from", () => {
    for (const key of [
      "projects.filterStatus",
      "projects.filterPriority",
      "projects.filterLead",
      "a11y.tableEditCell",
    ]) {
      expect(en[key], `en missing ${key}`).toBeTruthy();
      expect(zh[key], `zh missing ${key}`).toBeTruthy();
    }
  });
});
