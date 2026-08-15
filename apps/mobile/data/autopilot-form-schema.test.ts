import { describe, expect, it } from "vitest";
import {
  CronPreviewResponseSchema,
  EMPTY_AUTOPILOT_TRIGGER,
  AutopilotTriggerFormSchema,
  CreateAutopilotFormSchema,
} from "./schemas";

describe("AutopilotTriggerFormSchema", () => {
  it("accepts a schedule trigger with cron + timezone", () => {
    const parsed = AutopilotTriggerFormSchema.parse({
      kind: "schedule",
      cron_expression: "0 9 * * *",
      timezone: "Asia/Shanghai",
    });
    expect(parsed.kind).toBe("schedule");
    expect(parsed.cron_expression).toBe("0 9 * * *");
  });

  it("accepts schedule fields optional (webhook trigger has none)", () => {
    const parsed = AutopilotTriggerFormSchema.parse({ kind: "webhook" });
    expect(parsed.cron_expression).toBeUndefined();
    expect(parsed.timezone).toBeUndefined();
  });

  it("rejects an unknown trigger kind (drift guard on the wire payload)", () => {
    expect(() =>
      AutopilotTriggerFormSchema.parse({ kind: "carrier_pigeon" }),
    ).toThrow();
  });

  it("accepts edit-mode fields (label/enabled)", () => {
    const parsed = AutopilotTriggerFormSchema.parse({
      kind: "webhook",
      label: "晚高峰提醒",
      enabled: false,
    });
    expect(parsed.label).toBe("晚高峰提醒");
    expect(parsed.enabled).toBe(false);
  });
});

describe("CreateAutopilotFormSchema", () => {
  it("rejects an empty title (create form gate)", () => {
    expect(() =>
      CreateAutopilotFormSchema.parse({ title: "  ", assignee_id: "a-1" }),
    ).toThrow();
  });

  it("rejects a missing assignee", () => {
    expect(() =>
      CreateAutopilotFormSchema.parse({ title: "每日摘要" }),
    ).toThrow();
  });

  it("parses a complete create form", () => {
    const parsed = CreateAutopilotFormSchema.parse({
      title: "每日摘要",
      description: "每天早上生成",
      assignee_id: "agent-1",
      execution_mode: "create_issue",
    });
    expect(parsed.title).toBe("每日摘要");
    // assignee_type defaults to "agent" when omitted
    expect(parsed.assignee_type).toBe("agent");
    expect(parsed.execution_mode).toBe("create_issue");
  });
});

describe("CronPreviewResponseSchema", () => {
  it("parses next runs and tolerates a missing field as null", () => {
    expect(
      CronPreviewResponseSchema.parse({ next_runs: ["2026-08-17T01:00:00Z"] })
        .next_runs,
    ).toEqual(["2026-08-17T01:00:00Z"]);
    expect(CronPreviewResponseSchema.parse({}).next_runs).toBeNull();
  });
});

describe("EMPTY_AUTOPILOT_TRIGGER", () => {
  it("shapes like a webhook trigger with an empty id (detectable dropped body)", () => {
    expect(EMPTY_AUTOPILOT_TRIGGER.id).toBe("");
    // kind stays "webhook" — rotate is only offered on webhook triggers
    expect(EMPTY_AUTOPILOT_TRIGGER.kind).toBe("webhook");
    expect(EMPTY_AUTOPILOT_TRIGGER.webhook_token).toBeNull();
  });
});