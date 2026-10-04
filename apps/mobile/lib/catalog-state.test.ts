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
 * the member / agent / squad / project / label pickers. MYS-1908 added the
 * single-record case (`resolveRecordState`) for detail and edit routes, which
 * had the same collapse one level up: `if (isLoading) …; if (!record) "not
 * found"` reports an unreachable record as a deleted one.
 */
import { describe, expect, it } from "vitest";
import {
  isCatalogResolved,
  resolveCatalogEmpty,
  resolveCatalogState,
  resolveRecordState,
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

describe("resolveRecordState", () => {
  const settled = [{ isPending: false, isError: false }];
  const pending = [{ isPending: true, isError: false }];
  const failed = [{ isPending: false, isError: true }];

  it("calls a found record ready", () => {
    expect(resolveRecordState({ id: "a" }, settled)).toBe("ready");
    // A record found in a directory that also happens to be refetching is
    // still a record — the data is right there to render.
    expect(resolveRecordState({ id: "a" }, failed)).toBe("ready");
  });

  it("calls a settled miss empty — the only state that may say 'not found'", () => {
    expect(resolveRecordState(undefined, settled)).toBe("empty");
    expect(resolveRecordState(null, settled)).toBe("empty");
  });

  it("calls a failed read error, not empty", () => {
    // The regression: `isLoading` is false once a request fails, so the old
    // `if (!record)` branch rendered "does not exist" over a record that was
    // merely unreachable.
    expect(resolveRecordState(undefined, failed)).toBe("error");
  });

  it("calls a first-attempt read loading, not empty", () => {
    expect(resolveRecordState(undefined, pending)).toBe("loading");
  });

  it("names the failure, not the spinner, when both are present", () => {
    expect(resolveRecordState(undefined, [...pending, ...failed])).toBe("error");
  });

  it("keeps a page off 'not found' while ANY source is unsettled", () => {
    // `labels/[id]` resolves its row out of two catalogs. Absent from one is
    // not evidence of absent overall, so one settled-and-empty source beside a
    // still-loading one must not license the claim.
    expect(
      resolveRecordState(undefined, [
        { isPending: false, isError: false },
        { isPending: true, isError: false },
      ]),
    ).toBe("loading");
    expect(
      resolveRecordState(undefined, [
        { isPending: false, isError: false },
        { isPending: false, isError: true },
      ]),
    ).toBe("error");
  });

  it("calls every source settled and none holding it empty", () => {
    expect(resolveRecordState(undefined, settled.concat(settled))).toBe("empty");
  });
});
