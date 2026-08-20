import { describe, expect, it } from "vitest";
import {
  EMPTY_ISSUE_PULL_REQUESTS_RESPONSE,
  GitHubPullRequestSchema,
  IssuePullRequestsResponseSchema,
} from "./schemas";

/** Documented server payload for `GET /api/issues/:id/pull-requests` —
 *  mirrors web's `packages/views/issues/components/pull-request-list.test.tsx`
 *  makePR fixture so both clients parse the same shape. */
const FULL_PR = {
  id: "pr-1",
  provider: "github",
  workspace_id: "ws-1",
  repo_owner: "acme",
  repo_name: "widget",
  number: 1,
  title: "Test PR",
  state: "open",
  html_url: "https://github.com/acme/widget/pull/1",
  branch: "feat/x",
  author_login: "octocat",
  author_avatar_url: null,
  merged_at: null,
  closed_at: null,
  pr_created_at: "2026-08-15T00:00:00Z",
  pr_updated_at: "2026-08-16T00:00:00Z",
  mergeable: "mergeable",
  merge_state_status: "clean",
  snapshot_available: true,
  checks_rollup: "success",
  checks_totals: 7, // unknown field — .loose() must pass it through
  checks_total: 7,
  checks_passed: 7,
  checks_failed: 0,
  checks_running: 0,
  checks_pending: 0,
  failed_check_names: [],
  snapshot_stale: false,
  snapshot_fetched_at: "2026-08-16T00:00:00Z",
  additions: 437,
  deletions: 6,
  changed_files: 6,
};

describe("GitHubPullRequestSchema", () => {
  it("parses the full snapshot-bearing payload", () => {
    const pr = GitHubPullRequestSchema.parse(FULL_PR);
    expect(pr.id).toBe("pr-1");
    expect(pr.provider).toBe("github");
    expect(pr.repo_owner).toBe("acme");
    expect(pr.repo_name).toBe("widget");
    expect(pr.number).toBe(1);
    expect(pr.state).toBe("open");
    expect(pr.checks_rollup).toBe("success");
    expect(pr.additions).toBe(437);
    expect(pr.changed_files).toBe(6);
  });

  it("passes unknown server fields through (loose)", () => {
    const pr = GitHubPullRequestSchema.parse(FULL_PR);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((pr as any).checks_totals).toBe(7);
  });

  it("defaults every snapshot field when the old backend omits them", () => {
    const pr = GitHubPullRequestSchema.parse({
      id: "pr-old",
      workspace_id: "ws-1",
      repo_owner: "legacy",
      repo_name: "repo",
      number: 2,
      title: "Old backend PR",
      state: "merged",
      html_url: "https://x/pr/2",
      branch: null,
      author_login: null,
      author_avatar_url: null,
      merged_at: "2026-08-01T00:00:00Z",
      closed_at: "2026-08-01T00:00:00Z",
      pr_created_at: "2026-07-01T00:00:00Z",
      pr_updated_at: "2026-08-01T00:00:00Z",
    });
    expect(pr.snapshot_available).toBeUndefined();
    expect(pr.mergeable).toBeUndefined();
    expect(pr.merge_state_status).toBeUndefined();
    expect(pr.checks_rollup).toBeUndefined();
    expect(pr.checks_total).toBe(0);
    expect(pr.checks_passed).toBe(0);
    expect(pr.checks_failed).toBe(0);
    expect(pr.checks_running).toBe(0);
    expect(pr.failed_check_names).toEqual([]);
    expect(pr.snapshot_stale).toBe(false);
    expect(pr.additions).toBe(0);
    expect(pr.deletions).toBe(0);
    expect(pr.changed_files).toBe(0);
    // state round-trips verbatim (single enum from the server)
    expect(pr.state).toBe("merged");
  });
});

describe("IssuePullRequestsResponseSchema", () => {
  it("parses the documented response envelope", () => {
    const parsed = IssuePullRequestsResponseSchema.parse({
      pull_requests: [FULL_PR],
    });
    expect(parsed.pull_requests).toHaveLength(1);
    expect(parsed.pull_requests[0]?.id).toBe("pr-1");
  });

  it("defaults to an empty array when the key is missing", () => {
    const parsed = IssuePullRequestsResponseSchema.parse({});
    expect(parsed.pull_requests).toEqual([]);
  });

  it("matches the empty fallback shape", () => {
    expect(EMPTY_ISSUE_PULL_REQUESTS_RESPONSE).toEqual({ pull_requests: [] });
  });
});