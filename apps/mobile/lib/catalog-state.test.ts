/**
 * Unit tests for the four-state remote-catalog resolver.
 *
 * The regression these pin is a *state collapse*, not a data bug: a surface
 * that branches on `rows.length === 0` renders the same sentence for a request
 * still in flight, a request that failed, and a directory that really has none.
 * The matrix below is the whole contract — every combination of
 * (items, isPending, isError) that React Query can hand a surface.
 *
 * This began as `property-catalog-state.test.ts` (MYS-1892, the custom-property
 * catalog) and was generalised in MYS-1907, when the same collapse turned up in
 * the member / agent / squad / project / label pickers. The semantics did not
 * change; the names lost their `property` prefix.
 */
import { describe, expect, it } from "vitest";
import {
  isCatalogResolved,
  resolveCatalogEmpty,
  resolveCatalogState,
  unsettledCatalogStatus,
} from "./catalog-state";

describe("resolveCatalogState", () => {
  it("calls a resolved non-empty catalog ready", () => {
    expect(
      resolveCatalogState({
        items: ["severity"],
        isPending: false,
        isError: false,
      }),
    ).toBe("ready");
  });

  it("calls a settled empty catalog empty — the only state that may say 'none'", () => {
    expect(
      resolveCatalogState({ items: [], isPending: false, isError: false }),
    ).toBe("empty");
  });

  it("calls a first-attempt failure error, not empty", () => {
    // The exact production shape: `data` stays undefined, so the `= []`
    // default produced a length of 0 and the surface lied.
    expect(
      resolveCatalogState({
        items: undefined,
        isPending: false,
        isError: true,
      }),
    ).toBe("error");
  });

  it("calls a failure on the retry's pending pass error, not loading", () => {
    // React Query reports isPending again while retrying after a failure;
    // the user must not be sent back to a spinner that hides the failure.
    expect(
      resolveCatalogState({
        items: undefined,
        isPending: true,
        isError: true,
      }),
    ).toBe("error");
  });

  it("calls an unresolved, un-errored read loading", () => {
    expect(
      resolveCatalogState({
        items: undefined,
        isPending: true,
        isError: false,
      }),
    ).toBe("loading");
  });

  it("prefers cached items over a failed refetch", () => {
    // A stale list is usable data; blocking a picker on it would take working
    // rows away over a background refetch hiccup.
    expect(
      resolveCatalogState({ items: ["a"], isPending: false, isError: true }),
    ).toBe("ready");
  });

  it("prefers cached items while a refetch is in flight", () => {
    expect(
      resolveCatalogState({ items: ["a"], isPending: true, isError: false }),
    ).toBe("ready");
  });

  it("treats a settled read with no data and no error as empty, not loading", () => {
    // The `enabled: false` shape: nothing is in flight and nothing failed, so
    // a spinner would hang forever.
    expect(
      resolveCatalogState({
        items: undefined,
        isPending: false,
        isError: false,
      }),
    ).toBe("empty");
  });
});

describe("isCatalogResolved", () => {
  it("treats only ready and empty as settled truth", () => {
    expect(isCatalogResolved("ready")).toBe(true);
    expect(isCatalogResolved("empty")).toBe(true);
    expect(isCatalogResolved("loading")).toBe(false);
    expect(isCatalogResolved("error")).toBe(false);
  });
});

describe("unsettledCatalogStatus", () => {
  it("is null once every directory settled", () => {
    expect(unsettledCatalogStatus(["ready", "empty"])).toBeNull();
    expect(unsettledCatalogStatus(["ready"])).toBeNull();
  });

  it("names loading while any directory has nothing and none failed", () => {
    expect(unsettledCatalogStatus(["empty", "loading"])).toBe("loading");
    expect(unsettledCatalogStatus(["loading", "loading", "loading"])).toBe(
      "loading",
    );
  });

  it("names the failure, not the spinner, when both are present", () => {
    // A spinner over a request that already failed hides both the failure and
    // its retry — the user waits for something that will never arrive.
    expect(unsettledCatalogStatus(["error", "loading"])).toBe("error");
    expect(unsettledCatalogStatus(["error", "empty"])).toBe("error");
    expect(unsettledCatalogStatus(["error", "ready"])).toBe("error");
  });

  it("reports a single failed directory even when others are ready", () => {
    // The assignee picker reads three directories. One arriving does not make
    // the other two's absence a fact.
    expect(unsettledCatalogStatus(["ready", "error", "empty"])).toBe("error");
  });
});

describe("resolveCatalogEmpty", () => {
  it("paints the load state, and claims nothing, while unsettled", () => {
    expect(resolveCatalogEmpty(["loading", "empty"], false)).toEqual({
      kind: "status",
      status: "loading",
    });
    expect(resolveCatalogEmpty(["error"], true)).toEqual({
      kind: "status",
      status: "error",
    });
  });

  it("prefers the load state over the search verdict", () => {
    // With a query typed and the directory unreachable, "no matches" would be
    // a claim about a list we never read.
    expect(resolveCatalogEmpty(["error", "empty"], true)).toEqual({
      kind: "status",
      status: "error",
    });
  });

  it("calls a settled directory matched zero times a no-match", () => {
    expect(resolveCatalogEmpty(["ready"], true)).toEqual({ kind: "no-match" });
  });

  it("calls every settled directory empty an empty — no query involved", () => {
    expect(resolveCatalogEmpty(["empty", "empty"], false)).toEqual({
      kind: "empty",
    });
  });

  it("treats a settled directory with an active query as no-match, not empty", () => {
    // "This workspace has no labels" is the wrong sentence when the user is
    // looking at a search that matched nothing.
    expect(resolveCatalogEmpty(["empty"], true)).toEqual({ kind: "no-match" });
  });
});
