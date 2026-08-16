import { describe, expect, it } from "vitest";
import { issueKeys } from "./issue-keys";

describe("issueKeys.subscribers", () => {
  it("is workspace-scoped and stable under the subscribers segment", () => {
    expect(issueKeys.subscribers("ws-1", "issue-1")).toEqual([
      "issues",
      "ws-1",
      "subscribers",
      "issue-1",
    ]);
  });
});

describe("issueKeys.subscribersAll", () => {
  it("prefix-matches every subscribers sub-query of a workspace", () => {
    const key = issueKeys.subscribersAll("ws-1");
    expect(key.every((seg, i) => seg === issueKeys.subscribers("ws-1", "issue-1")[i])).toBe(
      true,
    );
    expect(key.every((seg, i) => seg === issueKeys.subscribers("ws-1", "issue-2")[i])).toBe(
      true,
    );
  });
});