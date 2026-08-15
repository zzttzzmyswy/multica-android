import { describe, expect, it } from "vitest";
import {
  AutopilotDetailSchema,
  AutopilotTriggerSchema,
  ListAutopilotRunsResponseSchema,
} from "./schemas";

describe("AutopilotTriggerSchema", () => {
  it("parses a schedule trigger with cron + timezone", () => {
    const parsed = AutopilotTriggerSchema.parse({
      id: "trg-1",
      autopilot_id: "ap-1",
      kind: "schedule",
      enabled: true,
      cron_expression: "0 9 * * *",
      timezone: "Asia/Shanghai",
      next_run_at: "2026-08-17T01:00:00Z",
      webhook_token: null,
      label: null,
      last_fired_at: null,
      created_at: "2026-08-16T00:00:00Z",
      updated_at: "2026-08-16T00:00:00Z",
    });
    expect(parsed.kind).toBe("schedule");
    expect(parsed.cron_expression).toBe("0 9 * * *");
    // absent optional fields stay undefined, not null — older servers omit them
    expect(parsed.webhook_url).toBeUndefined();
  });

  it("tolerates a missing webhook_url on older servers", () => {
    const parsed = AutopilotTriggerSchema.parse({
      id: "trg-2",
      autopilot_id: "ap-1",
      kind: "webhook",
      enabled: true,
      cron_expression: null,
      timezone: null,
      next_run_at: null,
      webhook_token: "tok",
      label: null,
      last_fired_at: null,
      created_at: "2026-08-16T00:00:00Z",
      updated_at: "2026-08-16T00:00:00Z",
    });
    expect(parsed.webhook_url).toBeUndefined();
    expect(parsed.kind).toBe("webhook");
  });
});

describe("AutopilotDetailSchema", () => {
  const baseAutopilot = {
    id: "ap-1",
    workspace_id: "ws-1",
    title: "每日新闻摘要",
    description: null,
    assignee_type: "agent",
    assignee_id: "agent-1",
    status: "active",
    execution_mode: "create_issue",
    created_by_type: "member",
    created_by_id: "user-1",
    last_run_at: null,
    created_at: "2026-08-16T00:00:00Z",
    updated_at: "2026-08-16T00:00:00Z",
  };

  it("parses a detail response with triggers", () => {
    const parsed = AutopilotDetailSchema.parse({
      autopilot: { ...baseAutopilot, can_write: true },
      triggers: [
        {
          id: "trg-1",
          autopilot_id: "ap-1",
          kind: "schedule",
          enabled: true,
          cron_expression: "0 9 * * *",
          timezone: "Asia/Shanghai",
          next_run_at: "2026-08-17T01:00:00Z",
          webhook_token: null,
          label: null,
          last_fired_at: null,
          created_at: "2026-08-16T00:00:00Z",
          updated_at: "2026-08-16T00:00:00Z",
        },
      ],
    });
    expect(parsed.autopilot.title).toBe("每日新闻摘要");
    expect(parsed.autopilot.can_write).toBe(true);
    expect(parsed.triggers).toHaveLength(1);
    // list/data-only derived fields absent here: trigger_kinds stays undefined
    expect(parsed.autopilot.trigger_kinds).toBeUndefined();
  });

  it("defaults absent triggers/can_write on older servers rather than failing", () => {
    const parsed = AutopilotDetailSchema.parse({ autopilot: baseAutopilot });
    expect(parsed.triggers).toEqual([]);
    expect(parsed.autopilot.can_write).toBeUndefined();
  });
});

describe("ListAutopilotRunsResponseSchema", () => {
  it("parses runs and keeps unknown status strings (drift tolerance)", () => {
    const parsed = ListAutopilotRunsResponseSchema.parse({
      autopilot_id: "ap-1",
      runs: [
        {
          id: "run-1",
          autopilot_id: "ap-1",
          source: "schedule",
          status: "completed",
          triggered_at: "2026-08-16T01:00:00Z",
          created_at: "2026-08-16T01:00:00Z",
        },
        {
          id: "run-2",
          autopilot_id: "ap-1",
          source: "manual",
          status: "some_future_status",
          triggered_at: "2026-08-16T02:00:00Z",
          created_at: "2026-08-16T02:00:00Z",
        },
      ],
    });
    expect(parsed.runs).toHaveLength(2);
    // unknown server status survives as a string — UI renders neutral fallback
    expect(parsed.runs[1].status).toBe("some_future_status");
  });

  it("defaults missing runs to []", () => {
    expect(ListAutopilotRunsResponseSchema.parse({ total: 0 }).runs).toEqual(
      [],
    );
  });
});