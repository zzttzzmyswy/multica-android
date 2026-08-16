import { describe, expect, it } from "vitest";
import {
  DashboardFailureByAgentListSchema,
  DashboardFailureByAgentSchema,
  DashboardFailureDailyListSchema,
  DashboardFailureDailySchema,
  EMPTY_DASHBOARD_FAILURE_BY_AGENT,
  EMPTY_DASHBOARD_FAILURE_DAILY,
} from "./schemas";

describe("DashboardFailureDailySchema", () => {
  it("parses a full failure row", () => {
    const parsed = DashboardFailureDailySchema.parse({
      date: "2026-08-15",
      failure_reason: "agent_error.process_failure",
      task_count: 3,
    });
    expect(parsed.date).toBe("2026-08-15");
    expect(parsed.failure_reason).toBe("agent_error.process_failure");
    expect(parsed.task_count).toBe(3);
  });

  it("keeps the succeeded bucket as an empty reason string", () => {
    const parsed = DashboardFailureDailySchema.parse({
      date: "2026-08-15",
      failure_reason: "",
      task_count: 10,
    });
    expect(parsed.failure_reason).toBe("");
  });

  it("defaults missing numeric fields to 0 (drift defense)", () => {
    const parsed = DashboardFailureDailySchema.parse({ date: "2026-08-15" });
    expect(parsed.failure_reason).toBe("");
    expect(parsed.task_count).toBe(0);
  });

  it("passes through unknown fields (loose)", () => {
    const parsed = DashboardFailureDailySchema.parse({
      date: "2026-08-15",
      failure_reason: "timeout",
      task_count: 1,
      future_field: "x",
    });
    expect((parsed as { future_field?: string }).future_field).toBe("x");
  });
});

describe("DashboardFailureDailyListSchema", () => {
  it("parses a list and defaults undefined to []", () => {
    expect(DashboardFailureDailyListSchema.parse(undefined)).toEqual([]);
    const parsed = DashboardFailureDailyListSchema.parse([
      { date: "2026-08-15", failure_reason: "timeout", task_count: 2 },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.failure_reason).toBe("timeout");
  });
});

describe("DashboardFailureByAgentSchema", () => {
  it("parses a full by-agent failure row", () => {
    const parsed = DashboardFailureByAgentSchema.parse({
      agent_id: "agent-1",
      failure_reason: "runtime_offline",
      task_count: 4,
    });
    expect(parsed.agent_id).toBe("agent-1");
    expect(parsed.failure_reason).toBe("runtime_offline");
    expect(parsed.task_count).toBe(4);
  });

  it("defaults missing fields (drift defense)", () => {
    const parsed = DashboardFailureByAgentSchema.parse({});
    expect(parsed.agent_id).toBe("");
    expect(parsed.failure_reason).toBe("");
    expect(parsed.task_count).toBe(0);
  });

  it("tolerates the server's anonymous bucket id", () => {
    const parsed = DashboardFailureByAgentSchema.parse({
      agent_id: "__restricted_agents__",
      failure_reason: "agent_error.unknown",
      task_count: 1,
    });
    expect(parsed.agent_id).toBe("__restricted_agents__");
  });
});

describe("DashboardFailureByAgentListSchema + EMPTY fallbacks", () => {
  it("parses a list and defaults undefined to []", () => {
    expect(DashboardFailureByAgentListSchema.parse(undefined)).toEqual([]);
  });

  it("exposes typed empty fallbacks for parseWithFallback", () => {
    expect(EMPTY_DASHBOARD_FAILURE_DAILY).toEqual([]);
    expect(EMPTY_DASHBOARD_FAILURE_BY_AGENT).toEqual([]);
  });
});