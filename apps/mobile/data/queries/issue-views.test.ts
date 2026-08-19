/**
 * Issue-view query-layer tests: key shape (mirrors web issueViewKeys) and
 * the canManageIssueView affordance rule (mirrors server issue_view.go).
 */
import { describe, expect, it, vi } from "vitest";

// Data-layer tests must mock `@/data/api` (vitest.config.ts note) so the
// native fetch chain never loads — the query module only calls `api` inside
// its queryFn, which these tests never execute.
vi.mock("@/data/api", () => ({ api: {} }));

import {
  canManageIssueView,
  issueViewDetailOptions,
  issueViewKeys,
  issueViewListOptions,
} from "./issue-views";

const VIEW = {
  id: "view-1",
  workspace_id: "ws-1",
  owner_id: "user-1",
  name: "Backlog",
  scope_type: "workspace",
  scope_id: null,
  scope_variant: null,
  visibility: "private",
  definition_version: 1,
  query: {},
  display: {},
  revision: 1,
  created_at: "2026-08-18T00:00:00Z",
  updated_at: "2026-08-18T00:00:00Z",
};

describe("issueViewKeys + list options", () => {
  it("keeps the web mirror key shape for scope lists", () => {
    expect(issueViewKeys.all("ws-1")).toEqual(["issue-views", "ws-1"]);
    expect(issueViewKeys.list("ws-1", { scope_type: "workspace" })).toEqual([
      "issue-views",
      "ws-1",
      "workspace",
      null,
    ]);
    expect(
      issueViewKeys.list("ws-1", {
        scope_type: "project",
        scope_id: "prj-1",
      }),
    ).toEqual(["issue-views", "ws-1", "project", "prj-1"]);
  });

  it("builds list options with workspace-gated enabled", () => {
    expect(issueViewListOptions("ws-1", { scope_type: "my" }).queryKey).toEqual(
      ["issue-views", "ws-1", "my", null],
    );
    expect(issueViewListOptions("ws-1", { scope_type: "my" }).enabled).toBe(
      true,
    );
    expect(issueViewListOptions(null, { scope_type: "my" }).enabled).toBe(
      false,
    );
  });

  it("builds detail options keyed by view id", () => {
    expect(issueViewDetailOptions("ws-1", "view-1").queryKey).toEqual([
      "issue-views",
      "ws-1",
      "detail",
      "view-1",
    ]);
  });
});

describe("canManageIssueView (enforces on render, server re-checks)", () => {
  it("owner can always manage", () => {
    expect(canManageIssueView(VIEW, "user-1", "member")).toBe(true);
    expect(canManageIssueView(VIEW, "user-1", null)).toBe(true);
  });

  it("non-owner cannot manage a private / foreign view", () => {
    expect(canManageIssueView(VIEW, "user-2", "owner")).toBe(false);
  });

  it("workspace owner/admin can manage a workspace-shared view", () => {
    expect(canManageIssueView({ ...VIEW, visibility: "workspace" }, "user-2", "owner")).toBe(true);
    expect(canManageIssueView({ ...VIEW, visibility: "workspace" }, "user-2", "admin")).toBe(true);
  });

  it("member role cannot manage even a shared view", () => {
    expect(canManageIssueView({ ...VIEW, visibility: "workspace" }, "user-2", "member")).toBe(false);
  });

  it("anonymous never manages", () => {
    expect(canManageIssueView(VIEW, null, "owner")).toBe(false);
    expect(canManageIssueView(VIEW, undefined, "owner")).toBe(false);
  });
});