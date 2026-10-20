/**
 * Guards for the chip bar's save-view shortcut (iteration 263, MYS-2273 gap #3).
 *
 * Web puts two controls at the trailing edge of its filter chip bar — Clear,
 * then a Save/Edit button (`packages/views/issues/components/filter-chips-bar.tsx:537-546`).
 * Mobile shipped only Clear, so a user who had just stacked six filters had to
 * scroll back up to the saved-views bar's "+" to keep them: the control that
 * exists for exactly that moment, out of sight of the moment.
 *
 * The three-way label is the part that is easy to ship wrong, because every
 * wrong version still renders a plausible button. Each case below is anchored
 * to the behaviour a user would notice, not to an implementation token.
 */
import { describe, expect, it } from "vitest";
import type { IssueView } from "@multica/core/api/schemas";
import {
  chipSaveAction,
  chipSaveOpensEdit,
  showsChipSave,
} from "./chip-save-view";

const view = (overrides: Partial<IssueView> = {}): IssueView =>
  ({
    id: "view-1",
    workspace_id: "ws-1",
    owner_id: "user-owner",
    name: "My triage",
    scope_type: "workspace",
    scope_id: null,
    scope_variant: null,
    visibility: "private",
    definition_version: 1,
    query: {},
    display: {},
    revision: 1,
    created_at: "",
    updated_at: "",
    ...overrides,
  }) as IssueView;

describe("chipSaveAction", () => {
  it("says Save when no view is open", () => {
    // Web: `activeView ? … : undefined` → the base `chip_save` label. Nothing
    // is open, so the button can only mean "file this as a new view".
    expect(chipSaveAction({ activeView: null, canManage: false })).toBe("save");
  });

  it("says Save even when the caller could manage a view that is not open", () => {
    // `canManage` describes a view; with no view open it describes nothing.
    // Reading it here would label the button "Edit" over a blank window.
    expect(chipSaveAction({ activeView: null, canManage: true })).toBe("save");
  });

  it("says Edit for an open view the user may manage", () => {
    expect(chipSaveAction({ activeView: view(), canManage: true })).toBe("edit");
  });

  it("says Save as for someone else's shared view", () => {
    // Web's `chip_save_as`. Collapsing this into "Edit" would tell a non-owner
    // their tap overwrites a view it would actually clone — a permission claim
    // the server then refuses.
    expect(chipSaveAction({ activeView: view(), canManage: false })).toBe(
      "save-as",
    );
  });
});

describe("chipSaveOpensEdit", () => {
  it("opens the create form when no view is open", () => {
    expect(chipSaveOpensEdit({ activeView: null, canManage: true })).toBe(false);
  });

  it("opens edit mode for an open, manageable view", () => {
    expect(chipSaveOpensEdit({ activeView: view(), canManage: true })).toBe(true);
  });

  it("opens the create form for an open view the user cannot manage", () => {
    // Opening `edit` here would fire an update the server rejects with 403.
    // "Save as" promises a clone, so a clone is what must open.
    expect(chipSaveOpensEdit({ activeView: view(), canManage: false })).toBe(
      false,
    );
  });

  it("agrees with the label in every case", () => {
    // The label and the dialog mode are two renderings of ONE decision. A
    // build where they disagree shows "Save as" and then edits in place.
    const cases = [
      { activeView: null, canManage: false },
      { activeView: null, canManage: true },
      { activeView: view(), canManage: true },
      { activeView: view(), canManage: false },
    ];
    for (const c of cases) {
      expect(chipSaveOpensEdit(c)).toBe(chipSaveAction(c) === "edit");
    }
  });
});

describe("showsChipSave", () => {
  it("offers the shortcut once the view list has settled", () => {
    expect(showsChipSave({ viewsSettled: true })).toBe(true);
  });

  it("withholds it while the view list is still unread", () => {
    // The label depends on which view is open and whether it is manageable, and
    // the dialog's edit-vs-create decision depends on resolving that id against
    // the list. Before the list arrives the id cannot resolve, so an "Edit"
    // tap would file a duplicate of a view the user cannot see. The bar's own
    // "+" is still there; this shortcut simply waits.
    expect(showsChipSave({ viewsSettled: false })).toBe(false);
  });
});
