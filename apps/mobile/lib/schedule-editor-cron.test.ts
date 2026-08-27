import { describe, it, expect } from "vitest";
import { cronFields, hasTimezonePrefix, parseCron, toCron } from "./schedule-editor-cron";
import type { ScheduleConfig } from "./schedule-editor-model";
import { getDefaultScheduleConfig } from "./schedule-editor-model";

// Port of the web cron-mapping tests, pinned to the canonical FORM the editor
// writes back. The mobile editor consumes the same structured model.

const TZ = "Asia/Shanghai";

function structured(expr: string): ScheduleConfig {
  const parsed = parseCron(expr, TZ);
  expect(parsed.raw, `expected ${JSON.stringify(expr)} to be structurable`).toBeNull();
  return parsed;
}

describe("parseCron — structurable expressions", () => {
  it("parses a fixed daily time", () => {
    const p = structured("0 9 * * *");
    expect(p.time).toEqual({ kind: "at", time: "09:00" });
    expect(p.days).toEqual({ kind: "every" });
    expect(p.timezone).toBe(TZ);
  });

  it("parses zero-padded fields", () => {
    expect(structured("05 09 * * *").time).toEqual({ kind: "at", time: "09:05" });
  });

  it("parses the weekday preset shape", () => {
    const p = structured("30 18 * * 1-5");
    expect(p.time).toEqual({ kind: "at", time: "18:30" });
    expect(p.days).toEqual({ kind: "weekly", daysOfWeek: [1, 2, 3, 4, 5] });
  });

  it("tolerates surrounding and repeated whitespace", () => {
    expect(structured("  0  9  *  *  *  ").time).toEqual({ kind: "at", time: "09:00" });
  });

  it("reads through a stray comma in a field", () => {
    expect(structured("0, 9 * * *").time).toEqual({ kind: "at", time: "09:00" });
    expect(structured("0 9 15, * *").days).toEqual({ kind: "monthly", dayOfMonth: 15 });
  });

  it("takes a question mark as a wildcard in every field", () => {
    expect(structured("? 10 * * *").raw).toBeNull();
    expect(structured("0 ? * * *").raw).toBeNull();
    expect(structured("0 9 ? * 1-5").raw).toBeNull();
    expect(structured("0 9 15 * ?").raw).toBeNull();
  });

  it("reads a question mark as the wildcard it is", () => {
    const p = structured("? 10 * * *");
    expect(p.time).toEqual({
      kind: "every",
      unit: "minutes",
      interval: 1,
      minute: 0,
      window: { from: "10:00", to: "10:59" },
    });
    expect(cronFields(p)).toBe("* 10 * * *");
  });

  it("reads a wildcard's unread upper end the way the server does", () => {
    expect(cronFields(structured("0 *-19 * * *"))).toBe("0 * * * *");
    expect(cronFields(structured("0 ?-19 * * *"))).toBe("0 * * * *");
    expect(cronFields(structured("0 *-19/2 * * *"))).toBe("0 */2 * * *");
    expect(cronFields(structured("0 9 * * ?-5"))).toBe("0 9 * * *");
    expect(cronFields(structured("0 9 *-15 * *"))).toBe("0 9 * * *");
  });

  it("leaves a question mark that is not a range's low end alone", () => {
    expect(parseCron("0 9-? * * *", TZ).raw).toBe("0 9-? * * *");
  });

  it("collapses a list carrying a wildcard", () => {
    expect(cronFields(structured("0,* 9 * * *"))).toBe("* 9 * * *");
    expect(cronFields(structured("0 9 * * 1,*"))).toBe("0 9 * * *");
    expect(cronFields(structured("0 9 * 1,* *"))).toBe("0 9 * * *");
  });

  it("leaves a wildcard list with an unparseable part alone", () => {
    expect(parseCron("*,abc 9 * * *", TZ).raw).toBe("*,abc 9 * * *");
    expect(parseCron("0 9 *,32 * *", TZ).raw).toBe("0 9 *,32 * *");
  });

  it("collapses a degenerate range to the fixed value it selects", () => {
    expect(cronFields(structured("*/65 * * * *"))).toBe("0 * * * *");
    expect(cronFields(structured("0 */24 * * *"))).toBe("0 0 * * *");
    expect(cronFields(structured("0 10-20/30 * * *"))).toBe("0 10 * * *");
    expect(cronFields(structured("5-5 9 * * *"))).toBe("5 9 * * *");
  });

  it("keeps an hour window whose step outruns it", () => {
    const p = structured("0 9-19/23 * * *");
    expect(p.time).toEqual({
      kind: "every",
      unit: "hours",
      interval: 23,
      minute: 0,
      window: { from: "09:00", to: "19:00" },
    });
    expect(cronFields(p)).toBe("0 9-19/23 * * *");
  });

  it("structures a degenerate step across all three dimensions", () => {
    const p = structured("*/65 10-20 14 * *");
    expect(p.days).toEqual({ kind: "monthly", dayOfMonth: 14 });
    expect(p.time).toEqual({
      kind: "every",
      unit: "hours",
      interval: 1,
      minute: 0,
      window: { from: "10:00", to: "20:00" },
    });
    expect(cronFields(p)).toBe("0 10-20 14 * *");
  });

  it.each([
    ["0 * * * *", 1, 0],
    ["15 * * * *", 1, 15],
    ["0 */2 * * *", 2, 0],
  ] as const)("parses hourly-interval %s", (expr, interval, minute) => {
    expect(structured(expr).time).toEqual({
      kind: "every",
      unit: "hours",
      interval,
      minute,
      window: null,
    });
  });

  it.each([
    ["0 0-23 * * *", "hours", 1, 0],
    ["0 0-23/3 * * *", "hours", 3, 0],
    ["*/30 0-23 * * *", "minutes", 30, 0],
  ] as const)("reads an hour range that spans the day as all day: %s", (expr, unit, interval, minute) => {
    expect(structured(expr).time).toEqual({
      kind: "every",
      unit,
      interval,
      minute,
      window: null,
    });
  });

  it.each([
    ["0 9-21 * * *", 1, "09:00", "21:00", 0],
    ["30 9-21 * * *", 1, "09:30", "21:30", 30],
    ["0 9-21/2 * * *", 2, "09:00", "21:00", 0],
  ] as const)("parses hour window %s", (expr, interval, from, to, minute) => {
    expect(structured(expr).time).toEqual({
      kind: "every",
      unit: "hours",
      interval,
      minute,
      window: { from, to },
    });
  });

  it("parses every-N-minutes with a window and without one", () => {
    expect(structured("*/15 * * * *").time).toEqual({
      kind: "every",
      unit: "minutes",
      interval: 15,
      minute: 0,
      window: null,
    });
    expect(structured("*/5 9-17 * * *").time).toEqual({
      kind: "every",
      unit: "minutes",
      interval: 5,
      minute: 0,
      window: { from: "09:00", to: "17:59" },
    });
  });
});

describe("parseCron — advanced / raw round-trip", () => {
  it("keeps unsupported expressions verbatim in raw", () => {
    for (const expr of [
      "0 9 15 * 6/2",
      "30 9 L * *",
      "@daily",
      "0 9 * JAN *",
    ]) {
      expect(parseCron(expr, TZ).raw).toBe(expr);
    }
  });

  it("keeps only the fields in raw when a timezone prefix is present", () => {
    const p = parseCron("TZ=UTC 30 9 15 * 6/2", TZ);
    expect(p.timezone).toBe("UTC");
    expect(p.raw).toBe("30 9 15 * 6/2");
  });
});

describe("hasTimezonePrefix / toCron round-trip", () => {
  it("recognizes the robfig timezone prefixes", () => {
    expect(hasTimezonePrefix("TZ=UTC 0 9 * * *")).toBe(true);
    expect(hasTimezonePrefix("CRON_TZ=UTC 0 9 * * *")).toBe(true);
    expect(hasTimezonePrefix("0 9 * * *")).toBe(false);
  });

  it("serializes structured configs with the TZ= prefix", () => {
    const cfg = getDefaultScheduleConfig(TZ);
    expect(toCron(cfg)).toBe("TZ=Asia/Shanghai 0 9 * * *");
  });

  it("round-trips structured expressions through parse → toCron", () => {
    for (const expr of [
      "0 9 * * *",
      "30 18 * * 1-5",
      "0 9 15 * *",
      "0 9-21/2 * * *",
      "30 */2 * * *",
      "*/15 * * * *",
      "*/5 9-17 * * *",
    ]) {
      const cfg = structured(expr);
      expect(toCron(cfg)).toBe(`TZ=${TZ} ${expr}`);
    }
  });

  it("passes an advanced raw through verbatim without stacking a prefix", () => {
    const cfg: ScheduleConfig = {
      ...getDefaultScheduleConfig(TZ),
      raw: "TZ=Asia/Tokyo 0 9 * * 6/2",
    };
    expect(toCron(cfg)).toBe("TZ=Asia/Tokyo 0 9 * * 6/2");
  });

  it("extracts a valid TZ= prefix into the timezone slot", () => {
    const p = parseCron("TZ=America/Los_Angeles 30 18 * * 1-5", TZ);
    expect(p.timezone).toBe("America/Los_Angeles");
    expect(p.days).toEqual({ kind: "weekly", daysOfWeek: [1, 2, 3, 4, 5] });
    expect(toCron(p)).toBe("TZ=America/Los_Angeles 30 18 * * 1-5");
  });

  it("leaves a zone the picker could not offer verbatim, fallback timezone kept", () => {
    const p = parseCron("TZ=Local 0 9 * * *", TZ);
    expect(p.raw).toBe("TZ=Local 0 9 * * *");
    expect(p.timezone).toBe(TZ);
  });
});