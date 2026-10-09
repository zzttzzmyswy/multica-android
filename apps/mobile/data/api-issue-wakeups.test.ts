import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ApiClient pulls in native modules at module scope; the Node vitest lane
// stubs them so the import chain resolves (same chain as
// api-invitations.test.ts). `api` is brought in by dynamic import because
// static ESM imports hoist above these mocks.
process.env.EXPO_PUBLIC_API_URL = "https://api.test";

vi.mock("expo-file-system", () => ({
  File: class {
    uri = "file:///mock";
    exists = false;
  },
  Paths: { document: { uri: "file:///doc" } },
}));

vi.mock("expo-file-system/legacy", () => ({
  createDownloadResumable: vi.fn(),
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

type ApiClient = typeof import("./api").api;
let api: ApiClient;

/** A spy on the private `fetch` the public methods route through. Typed with a
 *  one-argument signature so `mock.calls[0][0]` is the requested path rather
 *  than an empty tuple. */
const fetchSpy = () =>
  vi.spyOn(
    api as unknown as {
      fetch: (path: string, init?: unknown) => Promise<unknown>;
    },
    "fetch",
  );

beforeAll(async () => {
  ({ api } = await import("./api"));
});

beforeEach(() => {
  vi.restoreAllMocks();
});

/** A rule as the live server sends it (mu.zztweb.top, MYS-2013), trimmed. */
const RULE = {
  id: "01a11e1c-ee5f-7262-9151-5a3dd5964404",
  issue_id: "01a11e1c-add5-7b0d-92cd-07b862d6efb1",
  agent_id: "d85c4c9a-6527-4310-bc12-48dd82e50684",
  agent_name: "技术负责人-贵",
  instruction: "review the PR",
  kind: "event",
  mode: "once",
  event_types: ["issue.status_changed"],
  filter_agent_id: null,
  filter_task_id: null,
  filter_actor_type: null,
  filter_actor_id: null,
  filter_actor_name: "",
  interval_seconds: null,
  cron_expression: null,
  timezone: "UTC",
  next_fire_at: "2026-10-09T00:50:49.957019+00:00",
  enabled: true,
  revision: 1,
  disabled_at: null,
  last_task_id: null,
  last_error: null,
  condition: { type: "issue_field", field: "status", value: "in_review" },
  fire_count: 0,
  paused_reason: null,
};

const SYSTEM_RULE = {
  id: "",
  revision: 0,
  rule: "child_done",
  enabled: true,
  instruction: "",
  default_instruction: "when the sub-issues close, ...",
  customized: false,
  paused_reason: null,
  staged: false,
  stage: null,
  total: 3,
  remaining: 2,
  waiting: ["MYS-2"],
  target: { type: "agent", id: "a1", name: "Dev" },
  blocked: "",
  workspace_default: true,
};

const RUN = {
  id: "run-1",
  status: "completed",
  created_at: "2026-10-09T03:01:20+08:00",
  started_at: "2026-10-09T03:01:20+08:00",
  completed_at: "2026-10-09T03:03:29+08:00",
  checkin_note: "",
  triggers: ["condition.met"],
  commented: true,
};

describe("issue wakeup api methods (MYS-2023)", () => {
  it("listIssueWakeups GETs /api/issues/:id/wakeups", async () => {
    const spy = fetchSpy().mockResolvedValue([RULE]);
    const res = await api.listIssueWakeups("issue-1");
    expect(spy.mock.calls[0][0]).toBe("/api/issues/issue-1/wakeups");
    expect(res).toHaveLength(1);
    expect(res[0].agent_name).toBe("技术负责人-贵");
    expect(res[0].kind).toBe("event");
  });

  it("keeps a condition's variant fields, not just its type", async () => {
    // The whole point of the lenient condition schema: the renderer needs
    // `field` + `value` to say "moves to In Review". A schema that kept only
    // `type` would leave every condition with no description.
    fetchSpy().mockResolvedValue([RULE]);
    const res = await api.listIssueWakeups("issue-1");
    expect(res[0].condition).toMatchObject({
      type: "issue_field",
      field: "status",
      value: "in_review",
    });
  });

  it("degrades a rule with an unreadable kind instead of dropping it", async () => {
    fetchSpy().mockResolvedValue([{ ...RULE, kind: "something_new" }]);
    const res = await api.listIssueWakeups("issue-1");
    expect(res).toHaveLength(1);
    expect(res[0].kind).toBe("event");
  });

  it("returns an empty list rather than throwing on a broken payload", async () => {
    fetchSpy().mockResolvedValue({ not: "an array" });
    await expect(api.listIssueWakeups("issue-1")).resolves.toEqual([]);
  });

  it("listIssueSystemWakeups GETs /api/issues/:id/system-wakeups", async () => {
    const spy = fetchSpy().mockResolvedValue([SYSTEM_RULE]);
    const res = await api.listIssueSystemWakeups("issue-1");
    expect(spy.mock.calls[0][0]).toBe(
      "/api/issues/issue-1/system-wakeups",
    );
    expect(res[0].rule).toBe("child_done");
    expect(res[0].remaining).toBe(2);
    expect(res[0].target?.name).toBe("Dev");
  });

  it("listIssueWakeupRuns GETs the rule's runs path", async () => {
    const spy = fetchSpy().mockResolvedValue([RUN]);
    const res = await api.listIssueWakeupRuns("issue-1", "w-1");
    expect(spy.mock.calls[0][0]).toBe("/api/issues/issue-1/wakeups/w-1/runs");
    expect(res[0].checkin_note).toBe("");
    expect(res[0].triggers).toEqual(["condition.met"]);
  });

  it("percent-encodes the ids it interpolates", async () => {
    // Ids are server uuids today, but the paths are built by interpolation and
    // an unencoded separator would silently address a different rule.
    const spy = fetchSpy().mockResolvedValue([]);
    await api.listIssueWakeupRuns("i/1", "w 2");
    expect(spy.mock.calls[0][0]).toBe("/api/issues/i%2F1/wakeups/w%202/runs");
  });
});
