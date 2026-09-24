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
 * phone meaning) and "edit custom runtime" — the latter added in 176, on
 * web's own terms: a custom runtime whose profile is on hand.
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

  it("offers nothing when the viewer may neither edit nor delete", () => {
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

  it("leads with edit on a custom runtime whose profile is loaded", () => {
    expect(
      runtimeRowActions(
        { profile_id: "profile-1" },
        { canDelete: true, canEdit: true },
      ),
    ).toEqual(["edit", "delete-profile"]);
  });

  it("keeps the kebab for a custom runtime the viewer may edit but not delete", () => {
    // Web gates edit on `isCustomRuntime && profile` only, so a non-admin
    // owner of a custom runtime still has a way into the form.
    expect(
      runtimeRowActions(
        { profile_id: "profile-1" },
        { canDelete: false, canEdit: true },
      ),
    ).toEqual(["edit"]);
  });

  it("offers no edit on a built-in runtime even when the form is available", () => {
    // There is no profile behind a built-in runtime to open a form with.
    expect(
      runtimeRowActions({ profile_id: null }, { canDelete: true, canEdit: true }),
    ).toEqual(["delete"]);
  });

  it("offers no edit when the custom runtime's profile has not loaded", () => {
    expect(
      runtimeRowActions(
        { profile_id: "profile-1" },
        { canDelete: true, canEdit: false },
      ),
    ).toEqual(["delete-profile"]);
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
