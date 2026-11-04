import { describe, expect, it, vi } from "vitest";

// Data-layer tests must mock `@/data/api` (vitest.config.ts note) so the
// native fetch chain never loads.
const listIssueViews = vi.fn();
vi.mock("@/data/api", () => ({ api: { listIssueViews: (...a: unknown[]) => listIssueViews(...a) } }));

import { issueViewEverywhereOptions, issueViewKeys } from "./issue-views";

// The "All views" directory needs every view the caller can open, in ONE
// read. Upstream asks the server for `scope_type=all`; backends predating
// that branch reject the value with 400, so the fallback merges the two
// scopes those backends DO expose. Both branches are pinned here because the
// fallback is the one that runs against an older self-hosted server — the
// case nobody tests by hand.
describe("issueViewEverywhereOptions", () => {
  const keys = issueViewKeys;

  it("keys the cross-scope list separately from any single scope", () => {
    expect(keys.everywhere("ws-1")).toEqual(["issue-views", "ws-1", "everywhere"]);
    expect(keys.everywhere("ws-1")).not.toEqual(keys.list("ws-1", { scope_type: "workspace" }));
  });

  it("asks the server for scope_type=all", async () => {
    listIssueViews.mockReset().mockResolvedValue([{ id: "v1" }]);
    const opts = issueViewEverywhereOptions("ws-1");
    const result = await (opts.queryFn as () => Promise<unknown>)();
    expect(listIssueViews).toHaveBeenCalledWith({ scope_type: "all" });
    expect(result).toEqual([{ id: "v1" }]);
  });

  it("is disabled without a workspace", () => {
    expect(issueViewEverywhereOptions(null).enabled).toBe(false);
  });

  it("falls back to workspace+my when the server rejects scope_type=all", async () => {
    listIssueViews.mockReset().mockImplementation(({ scope_type }: { scope_type: string }) => {
      if (scope_type === "all") return Promise.reject(new Error("invalid scope_type"));
      return Promise.resolve(scope_type === "workspace" ? [{ id: "w1" }] : [{ id: "m1" }]);
    });
    const opts = issueViewEverywhereOptions("ws-1");
    const result = await (opts.queryFn as () => Promise<unknown>)();
    expect(result).toEqual([{ id: "w1" }, { id: "m1" }]);
  });

  it("does not hide a genuine network failure behind the fallback", async () => {
    // The fallback exists for ONE failure — an older server's 400. A network
    // error must not be answered with a shorter list, because the directory
    // would then render "you have fewer views than you do" as if it were
    // true. Both scopes fail here, so the rejection has to surface.
    listIssueViews.mockReset().mockRejectedValue(new Error("network down"));
    const opts = issueViewEverywhereOptions("ws-1");
    await expect((opts.queryFn as () => Promise<unknown>)()).rejects.toThrow();
  });

  it("surfaces the failure when the all-scope read fails AND a fallback scope fails", async () => {
    listIssueViews.mockReset().mockImplementation(({ scope_type }: { scope_type: string }) => {
      if (scope_type === "workspace") return Promise.resolve([{ id: "w1" }]);
      return Promise.reject(new Error("nope"));
    });
    const opts = issueViewEverywhereOptions("ws-1");
    await expect((opts.queryFn as () => Promise<unknown>)()).rejects.toThrow();
  });
});
