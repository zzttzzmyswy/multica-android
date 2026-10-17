import { describe, expect, it } from "vitest";
import {
  isEditableProjectColumn,
  isResolvedActorName,
  leadUpdatePatch,
  leadValueOf,
  PROJECT_CELL_TITLE_KEY,
  PROJECT_EDITABLE_COLUMNS,
  projectCellIsEditable,
  projectLeadCell,
} from "./project-inline-edit";

/**
 * The projects list gained in-row editing of status / priority / lead
 * (iteration 253, MYS-2202) — web's three in-place cells. These are the
 * decisions that module owns; the sheet that renders them is wired in
 * `project-inline-edit-wiring.test.ts`.
 *
 * The one that matters most is `projectLeadCell`'s three states. A lead's name
 * comes from a directory read, and a cell is the one place a user reads a value
 * as a fact without tapping anything — so "the read has not answered" and
 * "there is no lead" must not render the same string. That is the same defect
 * family `lib/catalog-state.ts` closed for pickers (MYS-1892 / MYS-1907) and
 * MYS-1908 closed for record pages, and it is the one thing a plausible-looking
 * implementation gets wrong by default:
 *
 *     {leadName ?? t("picker.unassigned")}      // ← the bug
 *
 * which is what the detail page's row does — correctly there, because that page
 * does not render until its reads settle.
 */
describe("which projects-list columns are editable", () => {
  it("is exactly web's three in-place cell controls", () => {
    // Web renders these as controls in BOTH views
    // (`packages/views/projects/components/projects-page.tsx:406,411,427`
    // compact; `:613,663,646` comfortable). Progress / issues / created are
    // read-only text there too.
    expect([...PROJECT_EDITABLE_COLUMNS]).toEqual([
      "status",
      "priority",
      "lead",
    ]);
    for (const column of ["progress", "issues", "created", "name"]) {
      expect(isEditableProjectColumn(column)).toBe(false);
    }
  });

  it("gives each editor a heading that already names that column elsewhere", () => {
    // The sheet's title, the table header and the filter chip must use one word
    // per column — a column that reads as "Priority" in the header and
    // something else on the sheet is the same field under two names.
    expect(PROJECT_CELL_TITLE_KEY.status).toBe("projects.filterStatus");
    expect(PROJECT_CELL_TITLE_KEY.priority).toBe("projects.filterPriority");
    expect(PROJECT_CELL_TITLE_KEY.lead).toBe("projects.filterLead");
  });

  it("lets a cell open only outside multi-select", () => {
    // The rule the row's kebab follows on this list and the other eight
    // (MYS-2197): in selection mode a row carries one control, and picking is
    // what the mode is for. A cell that still opened a picker would swallow the
    // tap that selects the row.
    expect(projectCellIsEditable("status", false)).toBe(true);
    expect(projectCellIsEditable("status", true)).toBe(false);
    expect(projectCellIsEditable("lead", true)).toBe(false);
    // …and the mode never makes a read-only column editable.
    expect(projectCellIsEditable("progress", false)).toBe(false);
    expect(projectCellIsEditable("progress", true)).toBe(false);
  });
});

describe("the lead patch", () => {
  it("clears both halves together", () => {
    // `lead_type: "member"` beside a null `lead_id` is a state the server has
    // to reject; the picker body's Unassigned row and the detail route both
    // mean "clear the lead".
    expect(leadUpdatePatch(null)).toEqual({ lead_type: null, lead_id: null });
  });

  it("carries the picked actor through", () => {
    expect(leadUpdatePatch({ type: "member", id: "u-1" })).toEqual({
      lead_type: "member",
      lead_id: "u-1",
    });
    expect(leadUpdatePatch({ type: "agent", id: "a-1" })).toEqual({
      lead_type: "agent",
      lead_id: "a-1",
    });
  });

  it("reads the selected lead off a project the way the detail route does", () => {
    // `app/(app)/[workspace]/project/[id]/picker/lead.tsx` derives the same
    // pair; if these two disagreed, the same picker would check a different row
    // depending on which sheet opened it.
    expect(
      leadValueOf({ lead_type: "agent", lead_id: "a-1" }),
    ).toEqual({ type: "agent", id: "a-1" });
    expect(leadValueOf({ lead_type: null, lead_id: null })).toBeNull();
    // A half-set pair is not a selection either — never "member: null".
    expect(leadValueOf({ lead_type: "member", lead_id: null })).toBeNull();
    expect(leadValueOf({ lead_type: null, lead_id: "u-1" })).toBeNull();
  });
});

describe("recognising a resolved actor name", () => {
  it("rejects every sentinel useActorLookup substitutes", () => {
    // Copied from `data/use-actor-name.ts:54-61`. The issue table drops the
    // same set before a name reaches a CSV (`table-view.tsx:564-567`).
    for (const name of ["Unknown", "Unknown Agent", "Unknown Squad", "Squad", "System"]) {
      expect(isResolvedActorName(name), name).toBe(false);
    }
    expect(isResolvedActorName("")).toBe(false);
  });

  it("accepts a real name, including ones that merely contain a sentinel", () => {
    expect(isResolvedActorName("Ada Lovelace")).toBe(true);
    expect(isResolvedActorName("Unknown")).toBe(false);
    // Substring matching would drop a teammate actually called this.
    expect(isResolvedActorName("Unknown Entity Bot")).toBe(true);
    expect(isResolvedActorName("Systems")).toBe(true);
  });
});

describe("the lead cell's three states", () => {
  const resolveTo = (name: string) => () => name;
  const base = {
    leadType: "member" as const,
    leadId: "u-1",
    catalogsResolved: true,
  };

  it("names a lead the directory resolved", () => {
    expect(
      projectLeadCell({ ...base, resolveName: resolveTo("Ada") }),
    ).toEqual({ kind: "name", name: "Ada" });
  });

  it("says nothing about a lead while the directories are unanswered", () => {
    // THE guard. Cold start: the project list has arrived, the member/agent
    // directories have not. Rendering 「无负责人」 here states an absence nobody
    // observed — and it is a wrong statement about a project that has a lead.
    expect(
      projectLeadCell({
        ...base,
        catalogsResolved: false,
        resolveName: resolveTo("Unknown"),
      }),
    ).toEqual({ kind: "pending" });
  });

  it("says nothing about an absent lead while the directories are unanswered", () => {
    // The same rule for the empty case: `lead_id === null` is real data, but
    // until the directories answer we cannot tell "this project has no lead"
    // from "this client has not read the roster that would name one". The
    // detail page may assert it because it renders only once its reads settle.
    expect(
      projectLeadCell({
        leadType: null,
        leadId: null,
        catalogsResolved: false,
        resolveName: resolveTo("Unknown"),
      }),
    ).toEqual({ kind: "pending" });
  });

  it("states the absence once the directories have settled", () => {
    expect(
      projectLeadCell({
        leadType: null,
        leadId: null,
        catalogsResolved: true,
        resolveName: resolveTo("Unknown"),
      }),
    ).toEqual({ kind: "none" });
  });

  it("names a lead whose actor row is gone by its id fragment", () => {
    // `lead_id` is set and the directories settled, so the lead EXISTS — only
    // the roster row is missing (an archived agent, a departed member). Web's
    // `useActorName` prints "Unknown Agent" here; `lib/actor-profile.ts` chose
    // the id fragment over that dead end, and the two clients have to agree.
    // The load-bearing half is that it does not collapse into `none`: the
    // project HAS a lead, and 「无负责人」 would be a lie.
    expect(
      projectLeadCell({
        ...base,
        leadId: "abcdef1234567890",
        resolveName: resolveTo("Unknown"),
      }),
    ).toEqual({ kind: "name", name: "abcdef12" });
  });
});
