import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

type ApiClientInstance = typeof import("./api").api;
let api: ApiClientInstance;

const fetchSpy = () =>
  vi.spyOn(
    api as unknown as {
      fetch: (path: string, init?: RequestInit) => Promise<unknown>;
    },
    "fetch",
  );

beforeAll(async () => {
  ({ api } = await import("./api"));
});

beforeEach(() => {
  vi.restoreAllMocks();
});

// Iteration-111 web alignment: getAutopilotRun lazily fetches a single run
// with its full trigger_payload — the list endpoint omits it to keep
// responses small. Mirrors web packages/core/api/client.ts getAutopilotRun.
describe("api.getAutopilotRun (iteration-111)", () => {
  it("GETs /api/autopilots/:id/runs/:runId", async () => {
    const spy = fetchSpy().mockResolvedValue({
      id: "run-1",
      autopilot_id: "ap-1",
      trigger_id: "trg-1",
      source: "webhook",
      status: "completed",
      issue_id: null,
      task_id: null,
      triggered_at: "2026-08-28T09:00:00Z",
      completed_at: "2026-08-28T09:00:01Z",
      failure_reason: null,
      trigger_payload: { event: "github.push", eventPayload: { ref: "main" } },
      result: {},
      created_at: "2026-08-28T09:00:00Z",
    });
    const run = await api.getAutopilotRun("ap-1", "run-1");
    const [path, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/autopilots/ap-1/runs/run-1");
    expect(init.method).toBe("GET");
    expect(run.id).toBe("run-1");
    expect(run.source).toBe("webhook");
    // The whole point of the endpoint: trigger_payload survives round-trip.
    expect(run.trigger_payload).toMatchObject({
      event: "github.push",
      eventPayload: { ref: "main" },
    });
  });

  it("passes through an abort signal", async () => {
    const spy = fetchSpy().mockResolvedValue(null);
    const controller = new AbortController();
    await api.getAutopilotRun("ap-1", "run-1", {
      signal: controller.signal,
    });
    const [path, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/autopilots/ap-1/runs/run-1");
    expect(init.signal).toBe(controller.signal);
  });
});