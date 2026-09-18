/**
 * Route-param construction for the issue table's row-level "new sub-issue"
 * entry (iteration 134). The hook around it only does the navigation; the
 * rule about which fields ride along is here, where it can be checked
 * without a router or a rendered table.
 */
import { describe, expect, it } from "vitest";
import { subIssueRouteParams } from "./sub-issue-route";

const PARENT = {
  id: "issue-1",
  identifier: "MYS-42",
  project_id: "project-1",
};

describe("subIssueRouteParams", () => {
  it("always carries the parent id — the only field the server needs", () => {
    expect(subIssueRouteParams(PARENT).parentIssueId).toBe("issue-1");
  });

  it("carries the identifier for the chip label", () => {
    expect(subIssueRouteParams(PARENT).parentIssueIdentifier).toBe("MYS-42");
  });

  it("inherits the parent's project", () => {
    expect(subIssueRouteParams(PARENT).parentProjectId).toBe("project-1");
  });

  it("omits project_id when the parent has none", () => {
    const params = subIssueRouteParams({ ...PARENT, project_id: null });
    expect(params).not.toHaveProperty("parentProjectId");
    expect(params.parentIssueId).toBe("issue-1");
  });

  it("omits the identifier when the parent has none", () => {
    const params = subIssueRouteParams({ ...PARENT, identifier: "" });
    expect(params).not.toHaveProperty("parentIssueIdentifier");
  });
});
