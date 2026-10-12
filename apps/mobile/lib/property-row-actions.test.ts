/**
 * The properties-list row actions (iteration 231, MYS-2102) — the mobile port
 * of web's row menu
 * (`packages/views/settings/components/properties-tab.tsx:260-315`).
 *
 * Two rules a plausible edit silently changes:
 *   - the owner/admin gate (web renders an empty `<span />`, not a disabled
 *     button, when it fails), and
 *   - the archive/restore flip on `property.archived` — a single fixed
 *     "archive" entry is a dead item on every archived row the "Show archived"
 *     switch can put on screen, and the server rejects a second archive.
 */
import { describe, expect, it } from "vitest";
import type { IssueProperty } from "@multica/core/types";
import {
  canManageProperties,
  propertyRowActionNeedsConfirm,
  propertyRowActions,
} from "./property-row-actions";

function property(archived: boolean, overrides: Partial<IssueProperty> = {}): IssueProperty {
  return {
    id: "p1",
    workspace_id: "w1",
    name: "Severity",
    type: "select",
    description: "",
    config: { options: [] },
    position: 0,
    archived,
    usage_count: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    ...overrides,
  } as IssueProperty;
}

describe("canManageProperties", () => {
  it("is owner-or-admin, web's `canManage`", () => {
    expect(canManageProperties("owner")).toBe(true);
    expect(canManageProperties("admin")).toBe(true);
    expect(canManageProperties("member")).toBe(false);
  });

  it("fails closed while the role is unknown", () => {
    // The member list resolves a beat after the catalog, so `undefined` is a
    // real state. Failing open here would flash a kebab the server then
    // rejects on write.
    expect(canManageProperties(null)).toBe(false);
    expect(canManageProperties(undefined)).toBe(false);
  });
});

describe("propertyRowActions", () => {
  it("offers edit then archive on an active property", () => {
    expect(propertyRowActions(property(false), { canManage: true })).toEqual([
      "edit",
      "archive",
    ]);
  });

  it("flips archive to restore on an archived property", () => {
    // Web's `property.archived ? 恢复 : 归档` ternary (:278).
    expect(propertyRowActions(property(true), { canManage: true })).toEqual([
      "edit",
      "restore",
    ]);
  });

  it("offers nothing without canManage", () => {
    // Web renders an empty `<span />` in this branch rather than a disabled
    // button; an empty list is what makes the caller render no trigger.
    expect(propertyRowActions(property(false), { canManage: false })).toEqual([]);
    expect(propertyRowActions(property(true), { canManage: false })).toEqual([]);
  });

  it("keeps archive and restore mutually exclusive", () => {
    // Both at once would be two opposite writes offered for one row.
    for (const archived of [true, false]) {
      const actions = propertyRowActions(property(archived), { canManage: true });
      expect(actions.includes("archive") && actions.includes("restore")).toBe(false);
    }
  });

  it("offers edit at all times a menu exists", () => {
    // `edit` is not archive-dependent; dropping it with the flip is the easy
    // mistake when the ternary gets refactored.
    for (const archived of [true, false]) {
      expect(propertyRowActions(property(archived), { canManage: true })).toContain("edit");
    }
  });
});

describe("propertyRowActionNeedsConfirm", () => {
  it("confirms archive but not restore", () => {
    // Web routes archive through `pendingArchive` / `ArchivePropertyDialog`
    // and writes restore straight through. Mirroring the asymmetry matters:
    // archive is what the dialog exists to make deliberate.
    expect(propertyRowActionNeedsConfirm("archive")).toBe(true);
    expect(propertyRowActionNeedsConfirm("restore")).toBe(false);
    expect(propertyRowActionNeedsConfirm("edit")).toBe(false);
  });
});
