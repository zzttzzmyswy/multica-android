// @vitest-environment node
/**
 * The status-scope resolver: which statuses an issue may be offered.
 *
 * Two properties carry the weight here, and both are the kind that can be
 * deleted without any other test noticing:
 *
 *   1. a FAILED workflow read must not be reported as authoritative — the
 *      option list is then a fallback, not a verified answer;
 *   2. an issue stranded on a Default-dropped status keeps that status as an
 *      option, or it can never be moved off it.
 */
import { describe, expect, it } from "vitest";
import type { IssueWorkflow, IssueWorkflowStep } from "@multica/core/types";
import {
  resolveStatusScope,
  workflowStatusOptions,
} from "./workflow-status-scope";
import { groupStatusOptionsByAppearance as groupStatusOptions } from "./status-options-core";
import type { StatusOption } from "./status-options-core";
import { ISSUE_STATUS_CATEGORIES } from "./issue-status-catalog";

const manual = (status_key: string): IssueWorkflowStep => ({
  status_key,
  handler: { type: "none" },
  instructions: "",
});
const columns = (...middle: string[]) =>
  ["backlog", "todo", ...middle, "blocked", "done", "cancelled"].map(manual);

const base = {
  id: "wf-default",
  workspace_id: "ws-1",
  name: "Default",
  description: "",
  is_default: true,
  owner_id: null,
  steps: columns("in_progress", "in_review"),
  project_ids: [],
  created_at: "",
  updated_at: "",
} satisfies IssueWorkflow;

const content: IssueWorkflow = {
  ...base,
  id: "wf-content",
  name: "Content",
  is_default: false,
  steps: columns("drafting", "editing"),
};

/** The whole catalog, as `useStatusOptions` would return it with no custom statuses. */
const catalog: StatusOption[] = [
  { key: "backlog", label: "Backlog", color: null, category: "backlog" },
  { key: "todo", label: "Todo", color: null, category: "todo" },
  { key: "in_progress", label: "In Progress", color: null, category: "in_progress" },
  { key: "in_review", label: "In Review", color: null, category: "in_review" },
  { key: "blocked", label: "Blocked", color: null, category: "blocked" },
  { key: "done", label: "Done", color: null, category: "done" },
  { key: "cancelled", label: "Cancelled", color: null, category: "cancelled" },
];

const projects = [
  { id: "p-content", workflow_id: "wf-content" },
  { id: "p-default", workflow_id: null },
];

describe("resolveStatusScope", () => {
  it("uses the project's workflow for an issue inside a project", () => {
    const scope = resolveStatusScope({
      workflows: [base, content],
      state: "ready",
      projectId: "p-content",
      projects,
    });
    expect(scope.workflow?.id).toBe("wf-content");
    expect(scope.defaultScope).toBeNull();
    expect(scope.authoritative).toBe(true);
  });

  it("uses Default for an issue outside any project", () => {
    const scope = resolveStatusScope({
      workflows: [base, content],
      state: "ready",
      projectId: null,
      projects,
    });
    expect(scope.workflow?.id).toBe("wf-default");
    expect(scope.authoritative).toBe(true);
  });

  it("limits nothing on a surface spanning projects, and knows it is complete", () => {
    const scope = resolveStatusScope({
      workflows: [base, content],
      state: "ready",
      projectId: undefined,
      projects,
    });
    expect(scope.workflow).toBeNull();
    expect(scope.authoritative).toBe(true);
  });

  it("is not authoritative while the read is pending", () => {
    const scope = resolveStatusScope({
      workflows: undefined,
      state: "pending",
      projectId: "p-content",
      projects,
    });
    expect(scope.workflow).toBeNull();
    expect(scope.authoritative).toBe(false);
    expect(scope.state).toBe("pending");
  });

  it("is not authoritative when the read failed", () => {
    // The distinction that matters: a failed read also yields no workflow, but
    // reporting it as "nothing limits you" would present the full catalog as
    // an answer the server may reject.
    const scope = resolveStatusScope({
      workflows: undefined,
      state: "failed",
      projectId: "p-content",
      projects,
    });
    expect(scope.workflow).toBeNull();
    expect(scope.authoritative).toBe(false);
    expect(scope.state).toBe("failed");
  });

  it("is authoritative-but-unlimited for a server that sends no workflows", () => {
    // A read that SUCCEEDED and returned nothing is a fact, not a gap: an
    // older backend has no workflow table. Contrast with the two above.
    const scope = resolveStatusScope({
      workflows: [],
      state: "ready",
      projectId: null,
      projects,
    });
    expect(scope.workflow).toBeNull();
    expect(scope.authoritative).toBe(true);
  });
});

describe("workflowStatusOptions", () => {
  it("offers the catalog untouched when nothing limits the issue", () => {
    const scope = resolveStatusScope({
      workflows: [base],
      state: "ready",
      projectId: undefined,
      projects,
    });
    expect(
      workflowStatusOptions(catalog, scope, null, ISSUE_STATUS_CATEGORIES).map(
        (o) => o.key,
      ),
    ).toEqual(catalog.map((o) => o.key));
  });

  it("offers a named workflow's columns, in the workflow's order", () => {
    const scope = resolveStatusScope({
      workflows: [base, content],
      state: "ready",
      projectId: "p-content",
      projects,
    });
    const keys = workflowStatusOptions(
      catalog,
      scope,
      "todo",
      ISSUE_STATUS_CATEGORIES,
    ).map((o) => o.key);
    // `drafting`/`editing` are not in the catalog, so they resolve to the bare
    // key — the point is that they are OFFERED and that the order is the
    // workflow's, not the catalog's.
    expect(keys).toEqual([
      "backlog",
      "todo",
      "drafting",
      "editing",
      "blocked",
      "done",
      "cancelled",
    ]);
    expect(keys).not.toContain("in_progress");
  });

  it("keeps a Default-dropped current status, at the end of its own category", () => {
    // Default lists no in_review column at all.
    const narrowed: IssueWorkflow = {
      ...base,
      steps: ["backlog", "todo", "in_progress", "blocked", "done", "cancelled"].map(
        manual,
      ),
    };
    const scope = resolveStatusScope({
      workflows: [narrowed],
      state: "ready",
      projectId: null,
      projects,
    });
    const keys = workflowStatusOptions(
      catalog,
      scope,
      "in_review",
      ISSUE_STATUS_CATEGORIES,
    ).map((o) => o.key);
    // Present, so the issue can be moved OFF it…
    expect(keys).toContain("in_review");
    // …and positioned after in_progress, not appended past cancelled.
    expect(keys.indexOf("in_review")).toBe(keys.indexOf("in_progress") + 1);
  });

  it("does NOT resurrect an unlisted status on a NAMED workflow", () => {
    // A named workflow is the project's declared pipeline; an issue on a
    // status it does not list is a state the server should not have made, and
    // offering it would put a status on screen that the write still refuses.
    const scope = resolveStatusScope({
      workflows: [base, content],
      state: "ready",
      projectId: "p-content",
      projects,
    });
    const keys = workflowStatusOptions(
      catalog,
      scope,
      "in_progress",
      ISSUE_STATUS_CATEGORIES,
    ).map((o) => o.key);
    expect(keys).not.toContain("in_progress");
  });

  it("does not duplicate a current status the workflow already lists", () => {
    const scope = resolveStatusScope({
      workflows: [base],
      state: "ready",
      projectId: null,
      projects,
    });
    const keys = workflowStatusOptions(
      catalog,
      scope,
      "in_progress",
      ISSUE_STATUS_CATEGORIES,
    ).map((o) => o.key);
    expect(keys.filter((k) => k === "in_progress")).toHaveLength(1);
  });

  it("resolves labels from the catalog for listed statuses", () => {
    const scope = resolveStatusScope({
      workflows: [base],
      state: "ready",
      projectId: null,
      projects,
    });
    const option = workflowStatusOptions(
      catalog,
      scope,
      null,
      ISSUE_STATUS_CATEGORIES,
    ).find((o) => o.key === "in_progress");
    expect(option?.label).toBe("In Progress");
    expect(option?.category).toBe("in_progress");
  });
});

/**
 * Grouping must not reorder a workflow's columns (iteration 288, found on a
 * device: the picker rendered Done ABOVE Blocked).
 *
 * Web's picker is one FLAT list in workflow order (`status-picker.tsx` maps
 * `projectOptions` directly), so a workflow's pipeline reads top to bottom.
 * Mobile renders category headings instead, and regrouping by the catalog's
 * category rank reorders the steps: the live Default workflow lists
 * `… in_review, blocked, done, cancelled`, while the category order puts
 * `done` before `blocked`.
 *
 * `groupStatusOptions` therefore orders the GROUPS by first appearance in the
 * option list rather than by the canonical category order. Both properties are
 * asserted below: the pipeline order survives, and a custom status still sits
 * under the heading of the category it behaves as.
 */
describe("groupStatusOptions keeps the workflow's own order", () => {
  const liveDefault: IssueWorkflow = {
    ...base,
    steps: [
      "backlog",
      "todo",
      "in_progress",
      "in_review",
      "blocked",
      "done",
      "cancelled",
    ].map(manual),
  };

  it("emits groups in the order their first step appears", () => {
    const scope = resolveStatusScope({
      workflows: [liveDefault],
      state: "ready",
      projectId: null,
      projects,
    });
    const options = workflowStatusOptions(
      catalog,
      scope,
      null,
      ISSUE_STATUS_CATEGORIES,
    );
    // The pipeline the server enforces, in its own order.
    expect(options.map((o) => o.key)).toEqual([
      "backlog",
      "todo",
      "in_progress",
      "in_review",
      "blocked",
      "done",
      "cancelled",
    ]);
    const groupOrder = groupStatusOptions(options, ISSUE_STATUS_CATEGORIES).map(
      (g) => g.category,
    );
    // blocked before done — the whole point. The canonical category order would
    // produce the reverse.
    expect(groupOrder.indexOf("blocked")).toBeLessThan(groupOrder.indexOf("done"));
  });

  it("still files a custom status under its own category's heading", () => {
    const withCustom = [
      ...catalog,
      { key: "qa", label: "QA", color: "#f00", category: "in_review" as const },
    ];
    const workflow: IssueWorkflow = {
      ...liveDefault,
      steps: [...liveDefault.steps, manual("qa")],
    };
    const scope = resolveStatusScope({
      workflows: [workflow],
      state: "ready",
      projectId: null,
      projects,
    });
    const options = workflowStatusOptions(
      withCustom,
      scope,
      null,
      ISSUE_STATUS_CATEGORIES,
    );
    const groups = groupStatusOptions(options, ISSUE_STATUS_CATEGORIES);
    const review = groups.find((g) => g.category === "in_review");
    expect(review?.options.map((o) => o.key)).toEqual(["in_review", "qa"]);
  });

  it("drops a category with no options instead of drawing an empty heading", () => {
    const scope = resolveStatusScope({
      workflows: [content],
      state: "ready",
      projectId: "p-content",
      projects,
    });
    const options = workflowStatusOptions(
      [...catalog, { key: "drafting", label: "Drafting", color: "#0f0", category: "todo" }],
      scope,
      null,
      ISSUE_STATUS_CATEGORIES,
    );
    const categories = groupStatusOptions(options, ISSUE_STATUS_CATEGORIES).map(
      (g) => g.category,
    );
    // `content` lists no in_progress/in_review column.
    expect(categories).not.toContain("in_progress");
    expect(categories).not.toContain("in_review");
  });
});
