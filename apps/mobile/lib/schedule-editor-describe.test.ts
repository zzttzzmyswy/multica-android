import { describe, it, expect } from "vitest";
import { describeSchedule, type DescribeT } from "./schedule-editor-describe";
import type { ScheduleConfig } from "./schedule-editor-model";

// Mock translator mirroring the i18next-style {{param}} interpolation the
// mobile i18n store performs.
function makeT(en: Record<string, string>): DescribeT {
  return (id: string, params?: Record<string, string | number>) => {
    let out = en[id] ?? id;
    for (const [k, v] of Object.entries(params ?? {})) {
      out = out.replaceAll(`{{${k}}}`, String(v));
    }
    return out;
  };
}

const EN: Record<string, string> = {
  "autopilots.schedule_editor.describe.time_at": "At {{time}}",
  "autopilots.schedule_editor.describe.time_every_hour": "Every hour at :{{minute}}",
  "autopilots.schedule_editor.describe.time_every_hours": "Every {{interval}} hours at :{{minute}}",
  "autopilots.schedule_editor.describe.time_every_hour_window": "Every hour",
  "autopilots.schedule_editor.describe.time_every_hours_window": "Every {{interval}} hours",
  "autopilots.schedule_editor.describe.time_every_minute": "Every minute",
  "autopilots.schedule_editor.describe.time_every_minutes": "Every {{interval}} minutes",
  "autopilots.schedule_editor.describe.window": "{{from}}–{{to}}",
  "autopilots.schedule_editor.describe.days_every": "Every day",
  "autopilots.schedule_editor.describe.days_monthly": "Day {{day}} of the month",
  "autopilots.schedule_editor.describe.days_long.sun": "Sunday",
  "autopilots.schedule_editor.describe.days_long.mon": "Monday",
  "autopilots.schedule_editor.describe.days_long.tue": "Tuesday",
  "autopilots.schedule_editor.describe.days_long.wed": "Wednesday",
  "autopilots.schedule_editor.describe.days_long.thu": "Thursday",
  "autopilots.schedule_editor.describe.days_long.fri": "Friday",
  "autopilots.schedule_editor.describe.days_long.sat": "Saturday",
  "autopilots.schedule_editor.describe.days_range": "{{from}}–{{to}}",
  "autopilots.schedule_editor.describe.days_join": ", ",
};

const t = makeT(EN);

function cfg(over: Partial<ScheduleConfig> = {}): ScheduleConfig {
  return {
    time: { kind: "at", time: "09:00" },
    days: { kind: "every" },
    timezone: "Asia/Shanghai",
    raw: null,
    ...over,
  };
}

describe("describeSchedule", () => {
  it("returns null in advanced-only mode", () => {
    expect(describeSchedule(t, cfg({ raw: "0 9 15 * 6/2" }))).toBeNull();
  });

  it("describes a fixed time every day", () => {
    expect(describeSchedule(t, cfg())).toBe("At 09:00 · Every day");
  });

  it("describes weekly days, collapsing runs of 3+", () => {
    expect(
      describeSchedule(t, cfg({ days: { kind: "weekly", daysOfWeek: [1, 2, 3, 4, 5] } })),
    ).toBe("At 09:00 · Monday–Friday");
    expect(
      describeSchedule(t, cfg({ days: { kind: "weekly", daysOfWeek: [0, 1, 2, 4] } })),
    ).toBe("At 09:00 · Sunday–Tuesday, Thursday");
  });

  it("describes monthly", () => {
    expect(
      describeSchedule(t, cfg({ days: { kind: "monthly", dayOfMonth: 15 } })),
    ).toBe("At 09:00 · Day 15 of the month");
  });

  it("describes every-N hours with and without a window", () => {
    expect(
      describeSchedule(
        t,
        cfg({ time: { kind: "every", interval: 3, unit: "hours", minute: 30, window: null } }),
      ),
    ).toBe("Every 3 hours at :30 · Every day");
    expect(
      describeSchedule(
        t,
        cfg({
          time: {
            kind: "every",
            interval: 2,
            unit: "hours",
            minute: 30,
            window: { from: "09:30", to: "21:30" },
          },
        }),
      ),
    ).toBe("Every 2 hours · 09:30–21:30 · Every day");
  });

  it("describes every-N minutes", () => {
    expect(
      describeSchedule(
        t,
        cfg({ time: { kind: "every", interval: 15, unit: "minutes", minute: 0, window: null } }),
      ),
    ).toBe("Every 15 minutes · Every day");
  });
});