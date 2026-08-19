/**
 * Project-scope container keying (MYS-437): saved views and view-bar
 * preferences are keyed per (wsId, scope_type, scope_id) container, so the
 * project surface's `{ scope_type: "project", scope_id }` must resolve to
 * keys distinct from the workspace and my containers — no cross-surface
 * cache bleed between the three issue workbenches.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/data/api", () => ({ api: {} }));

import {
  issueViewKeys,
  type IssueViewScope,
} from "./issue-views";
import { issueViewPrefKeys } from "./issue-view-prefs";
import { issueViewContainerKey } from "@/data/stores/active-issue-view-store";

const WS = "ws-1";
const PROJECT = "p-42";

describe("project-scope saved-view keying", () => {
  it("issueViewKeys.list is scoped to the project id", () => {
    expect(issueViewKeys.list(WS, { scope_type: "project", scope_id: PROJECT })).toEqual(
      ["issue-views", WS, "project", PROJECT],
    );
  });

  it("project / workspace / my containers get distinct list keys", () => {
    const project = issueViewKeys.list(WS, { scope_type: "project", scope_id: PROJECT });
    const projectOther = issueViewKeys.list(WS, {
      scope_type: "project",
      scope_id: "p-other",
    });
    const workspace = issueViewKeys.list(WS, { scope_type: "workspace" });
    const my = issueViewKeys.list(WS, { scope_type: "my" });
    const set = new Set([
      project.join("|"),
      projectOther.join("|"),
      workspace.join("|"),
      my.join("|"),
    ]);
    expect(set.size).toBe(4);
  });

  it("issueViewPrefKeys.scope keys prefs per project", () => {
    expect(issueViewPrefKeys.scope(WS, { scope_type: "project", scope_id: PROJECT })).toEqual(
      ["issue-view-prefs", WS, "project", PROJECT],
    );
    expect(
      issueViewPrefKeys.scope(WS, { scope_type: "project", scope_id: PROJECT }),
    ).not.toEqual(issueViewPrefKeys.scope(WS, { scope_type: "project", scope_id: "p-other" }));
    expect(
      issueViewPrefKeys.scope(WS, { scope_type: "project", scope_id: PROJECT }),
    ).not.toEqual(issueViewPrefKeys.scope(WS, { scope_type: "workspace" }));
  });
});

describe("active-view container keying", () => {
  it("contains the project id so each project holds its own open view", () => {
    const projectScope: IssueViewScope = {
      scope_type: "project",
      scope_id: PROJECT,
    };
    expect(issueViewContainerKey(WS, projectScope)).toBe(`${WS}:project:${PROJECT}`);
    expect(issueViewContainerKey(WS, projectScope)).not.toBe(
      issueViewContainerKey(WS, { scope_type: "workspace" }),
    );
    expect(issueViewContainerKey(WS, projectScope)).not.toBe(
      issueViewContainerKey(WS, { scope_type: "my" }),
    );
    expect(issueViewContainerKey(WS, projectScope)).not.toBe(
      issueViewContainerKey(WS, { scope_type: "project", scope_id: "p-other" }),
    );
  });
});