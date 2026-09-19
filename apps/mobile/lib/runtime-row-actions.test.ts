/**
 * Which actions a machine-detail runtime row offers (iteration 167). Mirrors
 * web `RuntimeRowMenu` (packages/views/runtimes/components/runtime-list.tsx):
 * the kebab only exists when the viewer may delete, and the label splits on
 * custom-vs-built-in the way web's `delete_action` / `delete_profile_action`
 * pair does — deleting a custom runtime takes the profile's registration away
 * from the whole workspace, which is a bigger statement than dropping one
 * built-in runtime row.
 *
 * Web's menu also carries "open in new tab" (a browser affordance with no
 * phone meaning) and "edit custom runtime" (mobile has no profile-edit form
 * yet), so delete is the row's only management action here — as web's own
 * comment says it is there.
 */
import { describe, expect, it } from "vitest";
import { runtimeRowActions, runtimeDeleteConfirmLabelKey } from "./runtime-row-actions";

describe("runtimeRowActions", () => {
  it("offers delete on a built-in runtime the viewer may delete", () => {
    expect(runtimeRowActions({ profile_id: null }, { canDelete: true })).toEqual([
      "delete",
    ]);
  });

  it("offers the profile-scoped delete on a custom runtime", () => {
    expect(
      runtimeRowActions({ profile_id: "profile-1" }, { canDelete: true }),
    ).toEqual(["delete-profile"]);
  });

  it("offers nothing when the viewer may not delete", () => {
    // The kebab is hidden rather than opening a sheet with no items — web
    // drops the whole column track for the same reason.
    expect(runtimeRowActions({ profile_id: null }, { canDelete: false })).toEqual([]);
    expect(
      runtimeRowActions({ profile_id: "profile-1" }, { canDelete: false }),
    ).toEqual([]);
  });

  it("treats a missing profile_id as built-in (older backends omit it)", () => {
    expect(runtimeRowActions({}, { canDelete: true })).toEqual(["delete"]);
  });
});

describe("runtimeDeleteConfirmLabelKey", () => {
  it("names the destructive button after what is actually removed", () => {
    expect(runtimeDeleteConfirmLabelKey({ profile_id: null })).toBe(
      "runtimes.row.delete",
    );
    expect(runtimeDeleteConfirmLabelKey({ profile_id: "profile-1" })).toBe(
      "runtimes.row.deleteProfile",
    );
  });
});
