import { describe, expect, it } from "vitest";
import { canWriteViewBarPrefs } from "./view-bar-prefs-write";

/**
 * `PUT /api/issue-view-preferences` upserts the WHOLE document: the `hidden`
 * and `order` arrays in the body are the scope's entire truth, not a patch. So
 * every write must be composed from a prefs doc that was actually read, pruned
 * against a views list that actually arrived. Anything else persists a
 * fabrication over the user's real customization.
 *
 * Two ways the mobile surface fabricated one (MYS-1916):
 *
 *   - `prefs` fell back to `EMPTY_VIEW_BAR_PREFS` while the preference read was
 *     still in flight (or had failed), so a single tap on "hide this view" sent
 *     `hidden: [just-that-one]` and silently dropped every view hidden before.
 *   - `views ?? []` fed the stale-id prune, so a failed views read made
 *     `sanitizeViewBarPrefs` judge EVERY known id stale and write
 *     `{hidden: [], order: []}` — the whole bar customization zeroed out.
 *
 * Web guards both behind one flag (`viewsReady`, view-bar.tsx:305-317). Here
 * the prune reads the views list as well, so both reads gate the write.
 */

describe("canWriteViewBarPrefs", () => {
  it("allows the write once both reads settled", () => {
    expect(
      canWriteViewBarPrefs({ prefsSettled: true, viewsSettled: true }),
    ).toBe(true);
  });

  it("drops the write while the preference read is still in flight", () => {
    // The wiped-`hidden` path: `prefs` is EMPTY_VIEW_BAR_PREFS here, so the doc
    // this write would send carries none of the user's previous hides.
    expect(
      canWriteViewBarPrefs({ prefsSettled: false, viewsSettled: true }),
    ).toBe(false);
  });

  it("drops the write while the views read is still in flight", () => {
    // The wiped-`order` path: the caller has no view ids to prune against, so
    // every entry in the doc would be judged stale.
    expect(
      canWriteViewBarPrefs({ prefsSettled: true, viewsSettled: false }),
    ).toBe(false);
  });

  it("drops the write when neither read settled", () => {
    expect(
      canWriteViewBarPrefs({ prefsSettled: false, viewsSettled: false }),
    ).toBe(false);
  });

  it("gates on success, not merely on settled", () => {
    // A FAILED read leaves the data undefined, which is exactly the state that
    // reads as "no prefs" / "no views" — so `isSuccess` is the gate, and it must
    // stay closed for an error too.
    expect(
      canWriteViewBarPrefs({ prefsSettled: false, viewsSettled: true }),
    ).toBe(false);
    expect(
      canWriteViewBarPrefs({ prefsSettled: true, viewsSettled: false }),
    ).toBe(false);
  });
});
