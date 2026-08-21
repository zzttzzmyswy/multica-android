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
  Paths: {
    document: { uri: "file:///doc" },
    cache: { uri: "file:///cache" },
  },
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

describe("dashboard run-time api methods", () => {
  it("getDashboardAgentRunTime GETs /api/dashboard/agent-runtime?days=7", async () => {
    const spy = fetchSpy().mockResolvedValue([
      {
        agent_id: "agent-1",
        total_seconds: 9000,
        task_count: 5,
        failed_count: 1,
        cancelled_count: 0,
      },
    ]);
    const res = await api.getDashboardAgentRunTime(7);
    expect(spy).toHaveBeenCalledWith(
      "/api/dashboard/agent-runtime?days=7",
      expect.objectContaining({ signal: undefined }),
    );
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({
      agent_id: "agent-1",
      total_seconds: 9000,
      task_count: 5,
    });
  });

  it("getDashboardAgentRunTime honours the abort signal", async () => {
    const spy = fetchSpy().mockResolvedValue([]);
    await api.getDashboardAgentRunTime(30, { signal: undefined });
    expect(spy).toHaveBeenCalledWith(
      "/api/dashboard/agent-runtime?days=30",
      expect.objectContaining({ signal: undefined }),
    );
  });

  it("getDashboardAgentRunTime degrades a drift response to []", async () => {
    fetchSpy().mockResolvedValue({ not: "a list" });
    const res = await api.getDashboardAgentRunTime(7);
    expect(res).toEqual([]);
  });

  it("getDashboardRunTimeDaily GETs /api/dashboard/runtime/daily?days=30", async () => {
    const spy = fetchSpy().mockResolvedValue([
      {
        date: "2026-08-15",
        total_seconds: 3600,
        task_count: 4,
        failed_count: 1,
        cancelled_count: 1,
      },
    ]);
    const res = await api.getDashboardRunTimeDaily(30);
    expect(spy).toHaveBeenCalledWith(
      "/api/dashboard/runtime/daily?days=30",
      expect.objectContaining({ signal: undefined }),
    );
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ date: "2026-08-15", total_seconds: 3600 });
  });

  it("getDashboardRunTimeDaily defaults cancelled_count for an old backend row", async () => {
    fetchSpy().mockResolvedValue([
      { date: "2026-08-15", total_seconds: 60, task_count: 1, failed_count: 0 },
    ]);
    const res = await api.getDashboardRunTimeDaily(7);
    expect(res[0]?.cancelled_count).toBe(0);
  });

  it("getDashboardRunTimeDaily degrades a drift response to []", async () => {
    fetchSpy().mockResolvedValue(null);
    const res = await api.getDashboardRunTimeDaily(7);
    expect(res).toEqual([]);
  });
});

describe("runtime management api methods (iteration-51)", () => {
  it("updateRuntime PATCHes /api/runtimes/:id with the patch body", async () => {
    const spy = fetchSpy().mockResolvedValue({ id: "r1", visibility: "public" });
    const res = await api.updateRuntime("r1", {
      visibility: "public",
      custom_name: "my machine",
    });
    expect(spy).toHaveBeenCalledWith(
      "/api/runtimes/r1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          visibility: "public",
          custom_name: "my machine",
        }),
      }),
    );
    expect(res).toMatchObject({ id: "r1", visibility: "public" });
  });

  it("updateRuntime can clear a custom name with an empty string", async () => {
    const spy = fetchSpy().mockResolvedValue({ id: "r1" });
    await api.updateRuntime("r1", { custom_name: "" });
    expect(spy).toHaveBeenCalledWith(
      "/api/runtimes/r1",
      expect.objectContaining({ body: JSON.stringify({ custom_name: "" }) }),
    );
  });

  it("updateRuntime passes apply_to_machine through for machine-wide renames", async () => {
    const spy = fetchSpy().mockResolvedValue({ id: "r1" });
    await api.updateRuntime("r1", { custom_name: "x", apply_to_machine: true });
    expect(spy).toHaveBeenCalledWith(
      "/api/runtimes/r1",
      expect.objectContaining({
        body: JSON.stringify({ custom_name: "x", apply_to_machine: true }),
      }),
    );
  });

  it("deleteRuntime DELETEs /api/runtimes/:id", async () => {
    const spy = fetchSpy().mockResolvedValue(undefined);
    await api.deleteRuntime("r1");
    expect(spy).toHaveBeenCalledWith(
      "/api/runtimes/r1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("unbindAgentsAndDeleteRuntime POSTs the confirmed agent set", async () => {
    const spy = fetchSpy().mockResolvedValue({
      status: "ok",
      agents_unbound: 2,
      tasks_cancelled: 3,
      autopilots_paused: 1,
    });
    const res = await api.unbindAgentsAndDeleteRuntime("r1", ["a1", "a2"]);
    expect(spy).toHaveBeenCalledWith(
      "/api/runtimes/r1/unbind-agents-and-delete",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ expected_active_agent_ids: ["a1", "a2"] }),
      }),
    );
    expect(res).toMatchObject({
      status: "ok",
      agents_unbound: 2,
      tasks_cancelled: 3,
      autopilots_paused: 1,
    });
  });
});
describe("createDownloadTask", () => {
  async function mockResumableOnce(result: unknown) {
    const { createDownloadResumable } = await import("expo-file-system/legacy");
    const m = createDownloadResumable as unknown as ReturnType<typeof vi.fn>;
    m.mockReturnValue({
      downloadAsync: vi.fn().mockResolvedValue(result),
      cancelAsync: vi.fn().mockResolvedValue(undefined),
    });
    return m;
  }

  it("rejects non-2xx responses instead of saving the error body", async () => {
    const m = await mockResumableOnce({
      uri: "file:///cache/x.bin",
      status: 404,
    });
    const task = api.createDownloadTask("/api/attachments/abc/download", "x.bin");
    expect(task).not.toBeNull();
    await expect(task!.done).rejects.toThrow(/HTTP 404/);
    // The request carried the internal auth header and resolved the
    // server-relative URL against the configured base.
    expect(m).toHaveBeenCalledWith(
      "https://api.test/api/attachments/abc/download",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("resolves the saved uri for 2xx responses", async () => {
    await mockResumableOnce({ uri: "file:///cache/x.bin", status: 200 });
    const task = api.createDownloadTask("/api/attachments/abc/download", "x.bin");
    await expect(task!.done).resolves.toMatchObject({
      uri: "file:///cache/x.bin",
    });
  });
});

describe("daemon self-update api methods (iteration-83, A2.4)", () => {
  it("initiateUpdate POSTs /api/runtimes/:id/update with target_version", async () => {
    const spy = fetchSpy().mockResolvedValue({
      id: "update-1",
      runtime_id: "r1",
      status: "pending",
      target_version: "0.4.20",
      created_at: "2026-08-21T00:00:00Z",
      updated_at: "2026-08-21T00:00:00Z",
    });
    const res = await api.initiateUpdate("r1", "0.4.20");
    expect(spy).toHaveBeenCalledWith(
      "/api/runtimes/r1/update",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ target_version: "0.4.20" }),
      }),
    );
    expect(res).toMatchObject({
      id: "update-1",
      runtime_id: "r1",
      status: "pending",
      target_version: "0.4.20",
    });
  });

  it("initiateUpdate degrades an unparseable body to a failed record", async () => {
    fetchSpy().mockResolvedValue({ whatever: true });
    const res = await api.initiateUpdate("r1", "0.4.20");
    expect(res.status).toBe("failed");
    expect(res.runtime_id).toBe("r1");
    expect(res.error).toBeTruthy();
  });

  it("getUpdateResult GETs /api/runtimes/:id/update/:updateId", async () => {
    const spy = fetchSpy().mockResolvedValue({
      id: "update-1",
      runtime_id: "r1",
      status: "completed",
      target_version: "0.4.20",
      output: "installed",
      created_at: "2026-08-21T00:00:00Z",
      updated_at: "2026-08-21T00:00:01Z",
    });
    const res = await api.getUpdateResult("r1", "update-1");
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith("/api/runtimes/r1/update/update-1");
    expect(res).toMatchObject({
      status: "completed",
      target_version: "0.4.20",
    });
  });

  it("getUpdateResult keeps a settled error body (failed + server error text)", async () => {
    fetchSpy().mockResolvedValue({
      id: "update-1",
      runtime_id: "r1",
      status: "failed",
      target_version: "0.4.20",
      error: "binary mismatch",
    });
    const res = await api.getUpdateResult("r1", "update-1");
    expect(res.status).toBe("failed");
    expect(res.error).toBe("binary mismatch");
  });
});
