import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockListAgentTasks, mockActivity } = vi.hoisted(() => ({
  mockListAgentTasks: vi.fn(),
  mockActivity: vi.fn(),
}));

vi.mock("@/data/api", () => ({
  api: { listAgentTasks: mockListAgentTasks, getWorkspaceAgentActivity30d: mockActivity },
}));

import { agentTaskKeys, agentTasksOptions } from "./agent-tasks";
import { agentActivityKeys, agentActivity30dOptions } from "./agent-activity";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("agentTasksOptions", () => {
  it("keys per-agent under the workspace prefix the realtime layer invalidates", () => {
    expect(agentTaskKeys.list("ws-1")).toEqual(["agent-tasks", "ws-1"]);
    expect(agentTaskKeys.detail("ws-1", "agent-1")).toEqual([
      "agent-tasks",
      "ws-1",
      "agent-1",
    ]);
    const opts = agentTasksOptions("ws-1", "agent-1");
    expect(opts.queryKey).toEqual(["agent-tasks", "ws-1", "agent-1"]);
    expect(opts.staleTime).toBe(30_000);
    expect(opts.enabled).toBe(true);
    expect(agentTasksOptions(null, "agent-1").enabled).toBe(false);
  });

  it("queryFn delegates to api.listAgentTasks with the agent id", async () => {
    mockListAgentTasks.mockResolvedValue([]);
    const opts = agentTasksOptions("ws-1", "agent-1");
    await opts.queryFn!({ signal: undefined } as never);
    expect(mockListAgentTasks).toHaveBeenCalledWith("agent-1", { signal: undefined });
  });
});

describe("agentActivity30dOptions", () => {
  it("keys 30d under the workspace prefix and stays disabled without a workspace", () => {
    expect(agentActivityKeys.all("ws-1")).toEqual(["agent-activity", "ws-1"]);
    expect(agentActivityKeys.last30d("ws-1")).toEqual([
      "agent-activity",
      "ws-1",
      "30d",
    ]);
    const opts = agentActivity30dOptions("ws-1");
    expect(opts.queryKey).toEqual(["agent-activity", "ws-1", "30d"]);
    expect(opts.staleTime).toBe(60_000);
    expect(agentActivity30dOptions(null).enabled).toBe(false);
  });

  it("queryFn delegates to api.getWorkspaceAgentActivity30d", async () => {
    mockActivity.mockResolvedValue([]);
    const opts = agentActivity30dOptions("ws-1");
    await opts.queryFn!({ signal: undefined } as never);
    expect(mockActivity).toHaveBeenCalledWith({ signal: undefined });
  });
});