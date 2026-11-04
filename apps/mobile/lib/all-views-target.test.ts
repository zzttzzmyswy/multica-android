import { describe, expect, it } from "vitest";
import { issueViewDirectoryTarget, scopeOfView } from "./all-views-target";
import type { IssueView } from "@multica/core/api/schemas";

function view(over: Partial<IssueView> & { id: string }): IssueView {
  return {
    workspace_id: "ws-1",
    owner_id: "u-me",
    name: over.id,
    scope_type: "workspace",
    scope_id: null,
    scope_variant: null,
    visibility: "private",
    definition_version: 1,
    query: {},
    display: {},
    revision: 1,
    created_at: "",
    updated_at: "",
    ...over,
  } as IssueView;
}

// Opening a row from the directory has to land on the surface that OWNS the
// view's scope, and mark the view active there. Web does this through
// `issueViewTarget` (packages/core/issue-views/view-target.ts). Getting the
// container key wrong is silent: the page navigates, no view opens, and the
// chip bar renders as "no view" — which looks like the view was deleted.
describe("issueViewDirectoryTarget", () => {
  const ws = "ws-1";
  const slug = "acme";

  it("sends a workspace view to the workspace issues page", () => {
    const target = issueViewDirectoryTarget(ws, slug, view({ id: "v1", scope_type: "workspace" }));
    expect(target?.href).toBe("/acme/more/issues?view=v1");
    expect(target?.containerKey).toBe("ws-1:workspace:null");
  });

  it("sends a my-scope view to My issues", () => {
    const target = issueViewDirectoryTarget(ws, slug, view({ id: "v2", scope_type: "my" }));
    expect(target?.href).toBe("/acme/my-issues?view=v2");
    expect(target?.containerKey).toBe("ws-1:my:null");
  });

  it("sends a project view to that project, keyed by the project", () => {
    const target = issueViewDirectoryTarget(
      ws,
      slug,
      view({ id: "v3", scope_type: "project", scope_id: "p1" }),
    );
    expect(target?.href).toBe("/acme/project/p1?view=v3");
    expect(target?.containerKey).toBe("ws-1:project:p1");
  });

  it("degrades a project view with no project id to the workspace surface", () => {
    // A newer backend could send a project-scoped view whose scope_id did not
    // survive; navigating to `/project/null` would be a dead route. Web's
    // `issueViewTarget` coalesces the same way.
    const target = issueViewDirectoryTarget(
      ws,
      slug,
      view({ id: "v4", scope_type: "project", scope_id: null }),
    );
    expect(target?.href).toBe("/acme/more/issues?view=v4");
    expect(target?.containerKey).toBe("ws-1:workspace:null");
  });

  it("degrades an unrecognised scope_type to the workspace surface", () => {
    const target = issueViewDirectoryTarget(
      ws,
      slug,
      view({ id: "v5", scope_type: "sidebar" as IssueView["scope_type"] }),
    );
    expect(target?.href).toBe("/acme/more/issues?view=v5");
  });

  it("returns null without a workspace slug — nothing can be routed yet", () => {
    expect(issueViewDirectoryTarget(ws, null, view({ id: "v6" }))).toBeNull();
    expect(issueViewDirectoryTarget(null, slug, view({ id: "v7" }))).toBeNull();
  });
});

// `scopeOfView` is the single source for the container a view lives in. It is
// used twice per row — once to route, once to decide which cache list a
// delete patches. If those two disagreed, deleting a row would leave it on
// screen: the route says "my", the patch went to "workspace".
describe("scopeOfView", () => {
  it("keeps a project view's project id", () => {
    expect(scopeOfView(view({ id: "v", scope_type: "project", scope_id: "p1" }))).toEqual({
      scope_type: "project",
      scope_id: "p1",
    });
  });

  it("collapses a project view without an id to workspace", () => {
    expect(scopeOfView(view({ id: "v", scope_type: "project", scope_id: null }))).toEqual({
      scope_type: "workspace",
    });
  });

  it("maps my to my without an id", () => {
    expect(scopeOfView(view({ id: "v", scope_type: "my", scope_id: "ignored" }))).toEqual({
      scope_type: "my",
    });
  });

  it("collapses an unknown scope_type to workspace", () => {
    expect(
      scopeOfView(view({ id: "v", scope_type: "sidebar" as IssueView["scope_type"] })),
    ).toEqual({ scope_type: "workspace" });
  });
});
