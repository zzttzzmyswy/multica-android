/**
 * Unit tests for `catalogRead` — the adapter between a React Query result and
 * the four-state resolver.
 *
 * The resolver is already pinned by `catalog-state.test.ts`; what can still go
 * wrong here is the *adapter*: reading the wrong React Query field (the original
 * bug read `data` through an `= []` default, which is exactly what erases the
 * distinction), or dropping the state on the way out. So these tests drive the
 * adapter with a fake query result shaped like React Query's, and assert that
 * both the state and the rows land where the surface expects them.
 */
import { describe, expect, it, vi } from "vitest";
import type { UseQueryResult } from "@tanstack/react-query";
import { catalogRead, recordRead, retryCatalogs } from "./catalog-read";

/** A `UseQueryResult` stand-in carrying only the fields the adapter reads. */
function query<T>(
  fields: Partial<UseQueryResult<T[]>>,
): UseQueryResult<T[]> {
  return { refetch: vi.fn(), ...fields } as unknown as UseQueryResult<T[]>;
}

describe("catalogRead", () => {
  it("keeps the rows and calls a populated read ready", () => {
    const read = catalogRead(query({ data: ["a"], isPending: false, isError: false }));
    expect(read.items).toEqual(["a"]);
    expect(read.state).toBe("ready");
    expect(read.isResolved).toBe(true);
  });

  it("falls back to an empty list but reports the failure, not emptiness", () => {
    // The defect in one assertion: `items` is `[]`, and the state is what
    // stops a surface from rendering that as "there are none".
    const read = catalogRead(
      query({ data: undefined, isPending: false, isError: true }),
    );
    expect(read.items).toEqual([]);
    expect(read.state).toBe("error");
    expect(read.isResolved).toBe(false);
  });

  it("reports an in-flight read as loading", () => {
    const read = catalogRead(
      query({ data: undefined, isPending: true, isError: false }),
    );
    expect(read.items).toEqual([]);
    expect(read.state).toBe("loading");
    expect(read.isResolved).toBe(false);
  });

  it("reports a settled empty read as empty — the only 'none' that is a fact", () => {
    const read = catalogRead(
      query({ data: [], isPending: false, isError: false }),
    );
    expect(read.items).toEqual([]);
    expect(read.state).toBe("empty");
    expect(read.isResolved).toBe(true);
  });

  it("passes the query's own refetch through as retry", () => {
    const refetch = vi.fn();
    const read = catalogRead(query({ data: undefined, isError: true, refetch }));
    read.retry();
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe("retryCatalogs", () => {
  it("re-runs every read, so one tap recovers the whole picker", () => {
    // The assignee picker reads three directories behind one retry button.
    const a = { retry: vi.fn() };
    const b = { retry: vi.fn() };
    const c = { retry: vi.fn() };
    retryCatalogs(a, b, c);
    expect(a.retry).toHaveBeenCalledTimes(1);
    expect(b.retry).toHaveBeenCalledTimes(1);
    expect(c.retry).toHaveBeenCalledTimes(1);
  });
});

describe("recordRead", () => {
  it("keeps a resolved row and calls it ready", () => {
    const read = recordRead({ id: "a" }, [
      query({ data: [{ id: "a" }], isPending: false, isError: false }),
    ]);
    expect(read.record).toEqual({ id: "a" });
    expect(read.state).toBe("ready");
    expect(read.isResolved).toBe(true);
  });

  it("reports a failed source as error, so the page never says 'not found'", () => {
    // The MYS-1908 defect in one assertion: `isLoading` is false after a
    // failure, so the old `if (!record)` branch called an unreachable record a
    // deleted one.
    const read = recordRead(undefined, [
      query({ data: undefined, isPending: false, isError: true }),
    ]);
    expect(read.record).toBeNull();
    expect(read.state).toBe("error");
    expect(read.isResolved).toBe(false);
  });

  it("reports an in-flight source as loading", () => {
    const read = recordRead(undefined, [
      query({ data: undefined, isPending: true, isError: false }),
    ]);
    expect(read.state).toBe("loading");
    expect(read.isResolved).toBe(false);
  });

  it("calls a settled miss empty", () => {
    const read = recordRead(undefined, [
      query({ data: [], isPending: false, isError: false }),
    ]);
    expect(read.state).toBe("empty");
    expect(read.isResolved).toBe(true);
  });

  it("normalizes an undefined row to null", () => {
    const read = recordRead<string>(undefined, [
      query({ data: [], isPending: false, isError: false }),
    ]);
    expect(read.record).toBeNull();
  });

  it("re-runs every source from the one retry, so a tap recovers the page", () => {
    // `labels/[id]` resolves its row out of two catalogs behind one retry.
    const a = vi.fn();
    const b = vi.fn();
    const read = recordRead(undefined, [
      query({ data: undefined, isError: true, refetch: a }),
      query({ data: undefined, isError: true, refetch: b }),
    ]);
    read.retry();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});
