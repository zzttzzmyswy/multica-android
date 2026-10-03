/**
 * Unit tests for the four-state property-catalog resolver (MYS-1892).
 *
 * The regression these pin is a *state collapse*, not a data bug: a surface
 * that branches on `properties.length === 0` renders the same sentence for a
 * request still in flight, a request that failed, and a workspace that really
 * has none. The matrix below is the whole contract — every combination of
 * (definitions, isPending, isError) that React Query can hand a surface.
 */
import { describe, expect, it } from "vitest";
import type { IssueProperty } from "@multica/core/types";
import {
  isPropertyCatalogResolved,
  resolvePropertyCatalogState,
} from "./property-catalog-state";

function property(id: string): IssueProperty {
  return {
    id,
    workspace_id: "w1",
    name: `Property ${id}`,
    type: "select",
    config: { options: [] },
    position: 0,
    archived: false,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
  };
}

describe("resolvePropertyCatalogState", () => {
  it("calls a resolved non-empty catalog ready", () => {
    expect(
      resolvePropertyCatalogState({
        definitions: [property("severity")],
        isPending: false,
        isError: false,
      }),
    ).toBe("ready");
  });

  it("calls a settled empty catalog empty — the only state that may say 'none'", () => {
    expect(
      resolvePropertyCatalogState({
        definitions: [],
        isPending: false,
        isError: false,
      }),
    ).toBe("empty");
  });

  it("calls a first-attempt failure error, not empty", () => {
    // The exact production shape: `data` stays undefined, so the old
    // `= []` default produced a length of 0 and the surface lied.
    expect(
      resolvePropertyCatalogState({
        definitions: undefined,
        isPending: false,
        isError: true,
      }),
    ).toBe("error");
  });

  it("calls a failure on the retry's pending pass error, not loading", () => {
    // React Query reports isPending again while retrying after a failure;
    // the user must not be sent back to a spinner that hides the failure.
    expect(
      resolvePropertyCatalogState({
        definitions: undefined,
        isPending: true,
        isError: true,
      }),
    ).toBe("error");
  });

  it("calls an unresolved, un-errored read loading", () => {
    expect(
      resolvePropertyCatalogState({
        definitions: undefined,
        isPending: true,
        isError: false,
      }),
    ).toBe("loading");
  });

  it("prefers cached definitions over a failed refetch", () => {
    // A stale catalog is usable data; blocking the surface on it would take
    // working chips away over a background refetch hiccup.
    expect(
      resolvePropertyCatalogState({
        definitions: [property("severity")],
        isPending: false,
        isError: true,
      }),
    ).toBe("ready");
  });

  it("prefers cached definitions while a refetch is in flight", () => {
    expect(
      resolvePropertyCatalogState({
        definitions: [property("severity")],
        isPending: true,
        isError: false,
      }),
    ).toBe("ready");
  });
});

describe("isPropertyCatalogResolved", () => {
  it("treats only ready and empty as settled truth", () => {
    expect(isPropertyCatalogResolved("ready")).toBe(true);
    expect(isPropertyCatalogResolved("empty")).toBe(true);
    expect(isPropertyCatalogResolved("loading")).toBe(false);
    expect(isPropertyCatalogResolved("error")).toBe(false);
  });
});
