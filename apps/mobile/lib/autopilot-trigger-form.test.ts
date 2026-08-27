import { describe, expect, it } from "vitest";
import {
  COMMON_TIMEZONES,
  buildTriggerCreate,
  buildTriggerUpdate,
  classifyScheduleRejection,
  probeSchedule,
  scheduleFromTrigger,
  type TriggerFormState,
} from "./autopilot-trigger-form";

function scheduleState(overrides: Partial<TriggerFormState> = {}): TriggerFormState {
  return {
    kind: "schedule",
    cronExpression: "0 9 * * *",
    timezone: "Asia/Shanghai",
    label: "",
    enabled: true,
    eventFilters: [],
    ...overrides,
  };
}

describe("COMMON_TIMEZONES", () => {
  it("includes the curated fallback zones (Asia/Shanghai + UTC present)", () => {
    expect(COMMON_TIMEZONES).toContain("UTC");
    expect(COMMON_TIMEZONES).toContain("Asia/Shanghai");
    expect(COMMON_TIMEZONES).toContain("America/New_York");
  });
});

describe("classifyScheduleRejection", () => {
  it("classifies a timezone rejection from the server code tag", () => {
    expect(
      classifyScheduleRejection({
        status: 400,
        message: "unknown time zone",
        body: { code: "invalid_timezone" },
      }).code,
    ).toBe("invalid_timezone");
  });

  it("defaults an untagged 400 to invalid_cron", () => {
    expect(
      classifyScheduleRejection({
        status: 400,
        message: "failed to parse",
        body: { code: "something_else" },
      }).code,
    ).toBe("invalid_cron");
    expect(
      classifyScheduleRejection({ status: 400, message: "boom", body: undefined })
        .code,
    ).toBe("invalid_cron");
  });

  it("keeps the parser's own words as detail", () => {
    const rejection = classifyScheduleRejection({
      status: 400,
      message: "unexpected token",
      body: {},
    });
    expect(rejection.detail).toBe("unexpected token");
  });
});

describe("scheduleFromTrigger", () => {
  it("defaults an empty/absent cron to the default schedule in the given timezone", () => {
    expect(scheduleFromTrigger(null, "Asia/Shanghai")).toEqual({
      time: { kind: "at", time: "09:00" },
      days: { kind: "every" },
      timezone: "Asia/Shanghai",
      raw: null,
    });
    expect(scheduleFromTrigger(undefined, "UTC")).toEqual(
      expect.objectContaining({ timezone: "UTC", raw: null }),
    );
    expect(scheduleFromTrigger("", "America/New_York")).toEqual(
      expect.objectContaining({ timezone: "America/New_York" }),
    );
  });

  it("falls back to Asia/Shanghai when timezone is absent", () => {
    expect(scheduleFromTrigger("0 9 * * *", null).timezone).toBe("Asia/Shanghai");
    expect(scheduleFromTrigger("0 9 * * *", undefined).timezone).toBe("Asia/Shanghai");
  });

  it("hydrates a model-level cron into structured form", () => {
    const config = scheduleFromTrigger("0 9 * * 1-5", "Asia/Shanghai");
    expect(config).toEqual({
      time: { kind: "at", time: "09:00" },
      days: { kind: "weekly", daysOfWeek: [1, 2, 3, 4, 5] },
      timezone: "Asia/Shanghai",
      raw: null,
    });
  });

  it("honors an embedded TZ= prefix over the passed timezone", () => {
    const config = scheduleFromTrigger("TZ=UTC 0 9 * * *", "Asia/Shanghai");
    expect(config.timezone).toBe("UTC");
    expect(config.raw).toBeNull();
  });

  it("keeps beyond-model expressions in raw (round-trip for advanced mode)", () => {
    // Month field non-wildcard — outside the structured model.
    const config = scheduleFromTrigger("0 9 * 1 *", "Asia/Shanghai");
    expect(config.raw).toBe("0 9 * 1 *");
    expect(config.timezone).toBe("Asia/Shanghai");
    // TZ prefix with a beyond-model body: zone extracted, raw holds the body.
    const prefixed = scheduleFromTrigger("TZ=America/New_York 0 9 * 1 *", "UTC");
    expect(prefixed.timezone).toBe("America/New_York");
    expect(prefixed.raw).toBe("0 9 * 1 *");
  });

  it("trims surrounding whitespace on both inputs", () => {
    const config = scheduleFromTrigger("  0 9 * * *  ", "  Asia/Shanghai  ");
    expect(config.timezone).toBe("Asia/Shanghai");
    expect(config.raw).toBeNull();
  });
});

describe("probeSchedule", () => {
  it("resolves null when the server accepts the expression", async () => {
    const probe = async () => ({ next_runs: ["2026-08-17T01:00:00Z"] });
    await expect(probeSchedule(probe, "0 9 * * *", "UTC")).resolves.toBeNull();
  });

  it("returns the classified rejection on a 400", async () => {
    const probe = async () => {
      throw { status: 400, message: "unexpected token", body: {} };
    };
    await expect(probeSchedule(probe, "not a cron", "UTC")).resolves.toEqual({
      code: "invalid_cron",
      detail: "unexpected token",
    });
  });

  it("resolves null on transport failure (must not block save)", async () => {
    const probe = async () => {
      throw new Error("network down");
    };
    await expect(probeSchedule(probe, "0 9 * * *", "UTC")).resolves.toBeNull();
  });
});

describe("buildTriggerCreate", () => {
  it("sends kind + cron + timezone for a schedule trigger", () => {
    expect(buildTriggerCreate(scheduleState())).toEqual({
      kind: "schedule",
      cron_expression: "0 9 * * *",
      timezone: "Asia/Shanghai",
    });
  });

  it("omits schedule fields for a webhook trigger", () => {
    const payload = buildTriggerCreate(scheduleState({ kind: "webhook" }));
    expect(payload.kind).toBe("webhook");
    expect(payload.cron_expression).toBeUndefined();
    expect(payload.timezone).toBeUndefined();
  });

  it("omits an empty cron/timezone instead of sending blanks", () => {
    expect(
      buildTriggerCreate(scheduleState({ cronExpression: "  ", timezone: "" })),
    ).toEqual({ kind: "schedule" });
  });

  it("ships event_filters for a webhook with filters and omits them when empty", () => {
    const withFilters = buildTriggerCreate(
      scheduleState({
        kind: "webhook",
        eventFilters: [{ event: "workflow_run", actions: ["completed"] }],
      }),
    );
    expect(withFilters).toEqual({
      kind: "webhook",
      event_filters: [{ event: "workflow_run", actions: ["completed"] }],
    });
    const empty = buildTriggerCreate(scheduleState({ kind: "webhook" }));
    expect(empty.event_filters).toBeUndefined();
  });
});

describe("buildTriggerUpdate", () => {
  it("includes label/enabled for webhook edits and no schedule fields or kind", () => {
    const payload = buildTriggerUpdate(
      scheduleState({ kind: "webhook", label: " 晚高峰 ", enabled: false }),
    );
    expect(payload).toEqual({
      label: "晚高峰",
      enabled: false,
    });
    expect(payload.cron_expression).toBeUndefined();
  });

  it("keeps schedule fields for schedule edits but strips kind", () => {
    expect(buildTriggerUpdate(scheduleState())).toEqual({
      cron_expression: "0 9 * * *",
      timezone: "Asia/Shanghai",
      label: "",
      enabled: true,
    });
  });

  it("omits event_filters unless explicitly passed (dirty gate)", () => {
    const base = scheduleState({ kind: "webhook", label: "digest" });
    expect(buildTriggerUpdate(base).event_filters).toBeUndefined();
    expect(
      buildTriggerUpdate(base, {
        eventFilters: [{ event: "issue" }],
      }).event_filters,
    ).toEqual([{ event: "issue" }]);
    expect(buildTriggerUpdate(base, { eventFilters: [] }).event_filters).toEqual([]);
  });

  it("never ships event_filters for schedule edits even when passed", () => {
    const payload = buildTriggerUpdate(scheduleState(), {
      eventFilters: [{ event: "issue" }],
    });
    expect(payload.event_filters).toBeUndefined();
  });
});