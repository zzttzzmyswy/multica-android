import { describe, expect, it } from "vitest";
import {
  DashboardAgentRunTimeListSchema,
  DashboardAgentRunTimeSchema,
  DashboardRunTimeDailyListSchema,
  DashboardRunTimeDailySchema,
  EMPTY_DASHBOARD_AGENT_RUN_TIME,
  EMPTY_DASHBOARD_RUN_TIME_DAILY,
} from "./schemas";

describe("DashboardAgentRunTimeSchema", () => {
  it("parses a full agent run-time row", () => {
    const parsed = DashboardAgentRunTimeSchema.parse({
      agent_id: "agent-1",
      total_seconds: 9000,
      task_count: 5,
      failed_count: 1,
      cancelled_count: 0,
    });
    expect(parsed.agent_id).toBe("agent-1");
    expect(parsed.total_seconds).toBe(9000);
    expect(parsed.task_count).toBe(5);
    expect(parsed.failed_count).toBe(1);
    expect(parsed.cancelled_count).toBe(0);
  });

  it("defaults missing numeric fields to 0 (drift defense)", () => {
    const parsed = DashboardAgentRunTimeSchema.parse({ agent_id: "agent-1" });
    expect(parsed.total_seconds).toBe(0);
    expect(parsed.task_count).toBe(0);
    expect(parsed.failed_count).toBe(0);
    expect(parsed.cancelled_count).toBe(0);
  });

  it("defaults cancelled_count for a pre-cancellation backend (web parity)", () => {
    const parsed = DashboardAgentRunTimeSchema.parse({
      agent_id: "agent-1",
      total_seconds: 60,
      task_count: 1,
      failed_count: 0,
    });
    expect(parsed.cancelled_count).toBe(0);
  });

  it("passes through unknown fields (loose)", () => {
    const parsed = DashboardAgentRunTimeSchema.parse({
      agent_id: "agent-1",
      total_seconds: 1,
      future_field: "x",
    });
    expect((parsed as { future_field?: string }).future_field).toBe("x");
  });
});

describe("DashboardAgentRunTimeListSchema + EMPTY fallback", () => {
  it("parses a list and defaults undefined to []", () => {
    expect(DashboardAgentRunTimeListSchema.parse(undefined)).toEqual([]);
    const parsed = DashboardAgentRunTimeListSchema.parse([
      { agent_id: "agent-1", total_seconds: 60, task_count: 1, failed_count: 0, cancelled_count: 0 },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.total_seconds).toBe(60);
  });

  it("exposes a typed empty fallback for parseWithFallback", () => {
    expect(EMPTY_DASHBOARD_AGENT_RUN_TIME).toEqual([]);
  });
});

describe("DashboardRunTimeDailySchema", () => {
  it("parses a full run-time daily row", () => {
    const parsed = DashboardRunTimeDailySchema.parse({
      date: "2026-08-15",
      total_seconds: 3600,
      task_count: 4,
      failed_count: 1,
      cancelled_count: 1,
    });
    expect(parsed.date).toBe("2026-08-15");
    expect(parsed.total_seconds).toBe(3600);
    expect(parsed.task_count).toBe(4);
    expect(parsed.failed_count).toBe(1);
    expect(parsed.cancelled_count).toBe(1);
  });

  it("defaults missing fields (drift defense)", () => {
    const parsed = DashboardRunTimeDailySchema.parse({});
    expect(parsed.date).toBe("");
    expect(parsed.total_seconds).toBe(0);
    expect(parsed.task_count).toBe(0);
    expect(parsed.failed_count).toBe(0);
    expect(parsed.cancelled_count).toBe(0);
  });
});

describe("DashboardRunTimeDailyListSchema + EMPTY fallback", () => {
  it("parses a list and defaults undefined to []", () => {
    expect(DashboardRunTimeDailyListSchema.parse(undefined)).toEqual([]);
  });

  it("exposes a typed empty fallback for parseWithFallback", () => {
    expect(EMPTY_DASHBOARD_RUN_TIME_DAILY).toEqual([]);
  });
});