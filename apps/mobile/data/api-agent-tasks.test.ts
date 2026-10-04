import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Same stub chain as api-failures.test.ts — ApiClient pulls in native modules
// at module scope, so the Node vitest lane stubs them and sets the API URL
// before the (dynamically imported) module evaluates.
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

const fetchSpy = () =>
  vi.spyOn(api as unknown as { fetch: () => Promise<unknown> }, "fetch");

beforeAll(async () => {
  ({ api } = await import("./api"));
});

beforeEach(() => {
  vi.restoreAllMocks();
});

const AGENT_TASK_ROW = {
  id: "task-1",
  agent_id: "agent-1",
  runtime_id: "runtime-1",
  issue_id: "issue-1",
  status: "completed",
  priority: 0,
  dispatched_at: "2026-08-24T01:00:00Z",
  started_at: "2026-08-24T01:00:00Z",
  completed_at: "2026-08-24T01:30:00Z",
  result: null,
  error: null,
  failure_reason: "",
  created_at: "2026-08-24T00:59:00Z",
  kind: "comment",
  trigger_summary: "Investigate flaky test",
};

describe("agent task / activity api methods", () => {
  it("listAgentTasks GETs /api/agents/:id/tasks and parses the array", async () => {
    const spy = fetchSpy().mockResolvedValue([AGENT_TASK_ROW]);
    const tasks = await api.listAgentTasks("agent-1");
    expect(spy).toHaveBeenCalledWith(
      "/api/agents/agent-1/tasks",
      expect.objectContaining({ signal: undefined }),
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe("task-1");
    expect(tasks[0].status).toBe("completed");
  });

  it("listAgentTasks falls back to an empty array on a malformed payload", async () => {
    fetchSpy().mockResolvedValue({ oops: "not-an-array" });
    const tasks = await api.listAgentTasks("agent-1");
    expect(tasks).toEqual([]);
  });

  // Attribution (MUL-4302 §9). The schema previously did not declare this key,
  // so a zod object stripped it and the whole "on behalf of <member>" feature
  // had no data to render. These pin the parse, not the presentation.
  it("listAgentTasks keeps a run's attribution (initiator + source + precise)", async () => {
    fetchSpy().mockResolvedValue([
      {
        ...AGENT_TASK_ROW,
        attribution: {
          source: "direct_human",
          precise: true,
          initiator: { id: "user-1", name: "MYSWY", email: "z@example.com" },
          originator: { id: "user-1", name: "MYSWY" },
        },
      },
    ]);
    const [task] = await api.listAgentTasks("agent-1");
    expect(task.attribution?.source).toBe("direct_human");
    expect(task.attribution?.precise).toBe(true);
    expect(task.attribution?.initiator).toMatchObject({
      id: "user-1",
      name: "MYSWY",
    });
  });

  it("keeps an unknown attribution source verbatim rather than dropping the task", async () => {
    // The server owns the source vocabulary; a level this build has never
    // heard of must survive the parse so the UI can print the raw value.
    fetchSpy().mockResolvedValue([
      {
        ...AGENT_TASK_ROW,
        attribution: {
          source: "some_future_level",
          precise: false,
          initiator: { id: "user-2" },
        },
      },
    ]);
    const [task] = await api.listAgentTasks("agent-1");
    expect(task.attribution?.source).toBe("some_future_level");
    // No name on the initiator — the raw id still resolves the object, so the
    // caller falls back to the generic "someone" label.
    expect(task.attribution?.initiator?.id).toBe("user-2");
    expect(task.attribution?.initiator?.name).toBeUndefined();
  });

  it("keeps an attribution that resolved no human (rule_owner, no initiator)", async () => {
    // The real sample from the NAS agent: an autopilot rule published the run,
    // so there is no accountable member at all. The object must still parse —
    // the render guard, not the schema, is what stays silent here.
    fetchSpy().mockResolvedValue([
      {
        ...AGENT_TASK_ROW,
        attribution: { source: "rule_owner", precise: true },
      },
    ]);
    const [task] = await api.listAgentTasks("agent-1");
    expect(task.attribution?.source).toBe("rule_owner");
    expect(task.attribution?.initiator).toBeUndefined();
  });

  it("leaves attribution undefined when an older backend omits it", async () => {
    fetchSpy().mockResolvedValue([AGENT_TASK_ROW]);
    const [task] = await api.listAgentTasks("agent-1");
    expect(task.attribution).toBeUndefined();
  });

  it("getWorkspaceAgentActivity30d GETs /api/agent-activity-30d and parses buckets", async () => {
    const spy = fetchSpy().mockResolvedValue([
      {
        agent_id: "agent-1",
        bucket_at: "2026-08-24T00:00:00Z",
        task_count: 12,
        failed_count: 2,
      },
    ]);
    const buckets = await api.getWorkspaceAgentActivity30d();
    expect(spy).toHaveBeenCalledWith(
      "/api/agent-activity-30d",
      expect.objectContaining({ signal: undefined }),
    );
    expect(buckets).toHaveLength(1);
    expect(buckets[0].agent_id).toBe("agent-1");
    expect(buckets[0].task_count).toBe(12);
    expect(buckets[0].failed_count).toBe(2);
  });

  it("getWorkspaceAgentActivity30d falls back to an empty array on drift", async () => {
    fetchSpy().mockResolvedValue({ nope: true });
    const buckets = await api.getWorkspaceAgentActivity30d();
    expect(buckets).toEqual([]);
  });

  it("cancelAgentTasks POSTs /api/agents/:id/cancel-tasks and parses the count", async () => {
    const spy = fetchSpy().mockResolvedValue({ cancelled: 3 });
    const res = await api.cancelAgentTasks("agent-1");
    expect(spy).toHaveBeenCalledWith(
      "/api/agents/agent-1/cancel-tasks",
      expect.objectContaining({ method: "POST" }),
    );
    expect(res.cancelled).toBe(3);
  });

  it("cancelAgentTasks falls back to zero on a malformed payload", async () => {
    fetchSpy().mockResolvedValue({ oops: "not-a-count" });
    const res = await api.cancelAgentTasks("agent-1");
    expect(res.cancelled).toBe(0);
  });
});
