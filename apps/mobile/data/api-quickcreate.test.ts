import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ApiClient pulls in native modules at module scope; the Node vitest lane
// stubs them so the import chain resolves (same pattern as
// api-subscription.test.ts). The env var satisfies api.ts's load-time guard.
// NOTE: `api` is brought in via dynamic import (below) because static ESM
// imports are hoisted — they would evaluate data/api.ts before this file's
// top-level statements, so the process.env assignment would never land first.
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

describe("issue quick-create api method", () => {
  it("POSTs prompt + agent_id to /api/issues/quick-create and parses task_id", async () => {
    const spy = fetchSpy().mockResolvedValue({ task_id: "task-42" });
    const res = await api.quickCreateIssue({
      agent_id: "agent-1",
      prompt: "Fix the toast color",
    });
    expect(spy).toHaveBeenCalledWith(
      "/api/issues/quick-create",
      expect.objectContaining({ method: "POST" }),
    );
    const [, opts] = spy.mock.calls[0] as unknown as [
      string,
      { body?: string },
    ];
    expect(JSON.parse(opts.body ?? "{}")).toEqual({
      agent_id: "agent-1",
      prompt: "Fix the toast color",
    });
    expect(res).toEqual({ task_id: "task-42" });
  });

  it("passes through optional fields unchanged", async () => {
    const spy = fetchSpy().mockResolvedValue({ task_id: "task-42" });
    await api.quickCreateIssue({
      squad_id: "squad-1",
      prompt: "Plan Q3 roadmap",
      project_id: "proj-1",
      priority: "high",
      due_date: "2026-09-01",
    });
    const [, opts] = spy.mock.calls[0] as unknown as [
      string,
      { body?: string },
    ];
    expect(JSON.parse(opts.body ?? "{}")).toEqual({
      squad_id: "squad-1",
      prompt: "Plan Q3 roadmap",
      project_id: "proj-1",
      priority: "high",
      due_date: "2026-09-01",
    });
  });
});