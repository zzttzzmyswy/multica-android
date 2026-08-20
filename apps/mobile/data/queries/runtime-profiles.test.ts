import { describe, expect, it, vi } from "vitest";

// Query-options tests only construct the options objects — the api call
// inside queryFn is never executed, so stub the module like vcs.test.ts.
vi.mock("@/data/api", () => ({ api: {} }));
// cloud-runtime.ts also imports workspace-store for its mutation hooks; the
// options under test don't touch it, but the module must load.
vi.mock("@/data/workspace-store", () => ({
  useWorkspaceStore: () => null,
}));

import {
  cloudRuntimeKeys,
  cloudRuntimeNodeListOptions,
} from "./cloud-runtime";
import { runtimeProfileKeys, runtimeProfileListOptions } from "./runtime-profiles";

describe("runtimeProfileKeys + runtimeProfileListOptions (iteration-82, A2.3)", () => {
  it("scopes keys and the query under the workspace id", () => {
    expect(runtimeProfileKeys.all("ws-1")).toEqual(["runtime-profiles", "ws-1"]);
    expect(runtimeProfileKeys.list("ws-1")).toEqual([
      "runtime-profiles",
      "ws-1",
      "list",
    ]);
    expect(runtimeProfileListOptions("ws-1").queryKey).toEqual([
      "runtime-profiles",
      "ws-1",
      "list",
    ]);
    expect(runtimeProfileListOptions("ws-1").enabled).toBe(true);
  });

  it("disables the query when no workspace is selected", () => {
    expect(runtimeProfileListOptions(null).enabled).toBe(false);
  });
});

describe("cloudRuntimeKeys + cloudRuntimeNodeListOptions (iteration-82, A2.2)", () => {
  it("scopes node keys under the workspace id with limit/offset", () => {
    expect(cloudRuntimeKeys.nodes("ws-1")).toEqual([
      "cloud-runtime",
      "ws-1",
      "nodes",
    ]);
    const opts = cloudRuntimeNodeListOptions("ws-1", { limit: 5, offset: 10 });
    expect(opts.queryKey).toEqual([
      "cloud-runtime",
      "ws-1",
      "nodes",
      { limit: 5, offset: 10 },
    ]);
    expect(opts.enabled).toBe(true);
    expect(typeof opts.refetchInterval).toBe("function");
    expect(opts.staleTime).toBe(15000);
  });

  it("polling interval is a function that returns 0 once no node is pending", () => {
    const opts = cloudRuntimeNodeListOptions("ws-1");
    const interval = opts.refetchInterval as (query: {
      state: { data?: { status: string }[] };
    }) => number | false;
    // data with a pending node → poll every 5s
    expect(interval({ state: { data: [{ status: "launching" }] } })).toBe(5000);
    // all settled → false (no polling)
    expect(
      interval({ state: { data: [{ status: "running" }] } }),
    ).toBe(false);
    // no data yet → false
    expect(interval({ state: { data: undefined } })).toBe(false);
  });
});