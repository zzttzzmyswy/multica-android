import { describe, expect, it } from "vitest";
import type { CardProperties } from "@/data/stores/issue-filter-slice";
import { findRowProject, issueRowProjectChip } from "./issue-row-project";

/**
 * The contract under test is web's `showProject` conjunction
 * (`list-row.tsx:60`): the chip exists only when the ISSUE has a project AND
 * the catalog resolved that project AND the display toggle is not off. Every
 * clause is tested on its own, because each one being skipped produces a
 * different wrong pixel — a phantom chip, a missing chip, or no chip at all.
 */

const ALL_ON: CardProperties = {
  priority: true,
  description: true,
  assignee: true,
  startDate: true,
  dueDate: true,
  project: true,
  childProgress: true,
  labels: true,
};

const project = { id: "p-1", title: "RV1103", icon: "🎥" };

describe("issueRowProjectChip", () => {
  it("draws the project's title and icon when everything resolved", () => {
    expect(
      issueRowProjectChip({
        issue: { project_id: "p-1" },
        project,
        cardProperties: ALL_ON,
      }),
    ).toEqual({ title: "RV1103", icon: "🎥" });
  });

  it("draws nothing for a rootless issue even when a project was handed in", () => {
    // Web's conjunction starts at `project`, which list-view derives from
    // `issue.project_id` — so an issue with none can never show a chip. A
    // caller that passes the wrong row must not turn that into a phantom.
    expect(
      issueRowProjectChip({
        issue: { project_id: null },
        project,
        cardProperties: ALL_ON,
      }),
    ).toBeNull();
  });

  it("draws nothing while the project catalog has not answered", () => {
    // `null` here is "not resolved yet", not "no project". The chip is
    // additive, so silence is the only honest pixel — the row must never
    // print a placeholder that a later read would have to retract.
    expect(
      issueRowProjectChip({
        issue: { project_id: "p-1" },
        project: null,
        cardProperties: ALL_ON,
      }),
    ).toBeNull();
    expect(
      issueRowProjectChip({
        issue: { project_id: "p-1" },
        project: undefined,
        cardProperties: ALL_ON,
      }),
    ).toBeNull();
  });

  it("draws nothing for a project the settled catalog no longer carries", () => {
    // Deleted / archived-and-filtered: web's `projectMap.get` returns
    // undefined and its `showProject` short-circuits identically.
    expect(
      issueRowProjectChip({
        issue: { project_id: "p-gone" },
        project: null,
        cardProperties: ALL_ON,
      }),
    ).toBeNull();
  });

  it("refuses a project whose id disagrees with the issue's", () => {
    // Guards the wiring, not the data: a `find` that returned the wrong row
    // would otherwise label every issue with one project's name.
    expect(
      issueRowProjectChip({
        issue: { project_id: "p-1" },
        project: { id: "p-2", title: "Other" },
        cardProperties: ALL_ON,
      }),
    ).toBeNull();
  });

  it("honours the display toggle being explicitly off", () => {
    expect(
      issueRowProjectChip({
        issue: { project_id: "p-1" },
        project,
        cardProperties: { ...ALL_ON, project: false },
      }),
    ).toBeNull();
  });

  it("treats a missing toggle bag as all-on, matching web's default", () => {
    // The board card defaults the same way (`ALL_CARD_PROPERTIES_ON`), and
    // web's view-store default is on for every key; a surface that has not
    // wired the prop must render today's content, not less of it.
    expect(
      issueRowProjectChip({ issue: { project_id: "p-1" }, project }),
    ).toEqual({ title: "RV1103", icon: "🎥" });
  });

  it("falls back to a null icon so the renderer draws its folder glyph", () => {
    expect(
      issueRowProjectChip({
        issue: { project_id: "p-1" },
        project: { id: "p-1", title: "No icon" },
      })?.icon,
    ).toBeNull();
  });

  it("draws nothing for a project with a blank title", () => {
    // Otherwise the row paints a floating folder glyph with no label.
    expect(
      issueRowProjectChip({
        issue: { project_id: "p-1" },
        project: { id: "p-1", title: "   ", icon: null },
        cardProperties: ALL_ON,
      }),
    ).toBeNull();
  });

  it("trims surrounding whitespace off the label", () => {
    expect(
      issueRowProjectChip({
        issue: { project_id: "p-1" },
        project: { id: "p-1", title: "  RV1103  ", icon: null },
        cardProperties: ALL_ON,
      })?.title,
    ).toBe("RV1103");
  });
});

describe("findRowProject", () => {
  const catalog = [
    { id: "p-1", title: "RV1103", icon: "🎥" },
    { id: "p-2", title: "KVM", icon: null },
  ];

  it("resolves the row whose id matches", () => {
    expect(findRowProject(catalog, "p-2")).toEqual({ id: "p-2", title: "KVM", icon: null });
  });

  it("returns null for an id the catalog does not carry", () => {
    expect(findRowProject(catalog, "p-gone")).toBeNull();
  });

  it("returns null for a rootless issue without touching the catalog", () => {
    expect(findRowProject(catalog, null)).toBeNull();
    expect(findRowProject(catalog, undefined)).toBeNull();
    expect(findRowProject(catalog, "")).toBeNull();
  });

  it("returns null while the catalog has not arrived", () => {
    // `undefined` is the query's pre-answer state, `[]` is a settled empty
    // workspace — both mean "cannot name this issue's project".
    expect(findRowProject(undefined, "p-1")).toBeNull();
    expect(findRowProject([], "p-1")).toBeNull();
  });
});
