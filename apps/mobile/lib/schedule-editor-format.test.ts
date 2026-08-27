import { describe, it, expect } from "vitest";
import { countdownDiff, formatInTimeZone } from "./schedule-editor-format";

// 2026-07-14T01:00:00Z is 18:00 of the 13th in Los Angeles (PDT, UTC-7).
const iso = "2026-07-14T01:00:00Z";

describe("formatInTimeZone", () => {
  it("renders the instant in the given timezone", () => {
    const out = formatInTimeZone(iso, "America/Los_Angeles", "en-US");
    expect(out).toContain("13");
    expect(out).toMatch(/6:00\s?PM|18:00/);
  });

  it("renders the same instant differently in another timezone", () => {
    const out = formatInTimeZone(iso, "Asia/Shanghai", "en-US");
    expect(out).toContain("14");
    expect(out).toMatch(/9:00\s?AM|09:00/);
  });

  it("falls back to local time for a zone this runtime does not know", () => {
    expect(formatInTimeZone(iso, "Not/AZone", "en-US")).not.toBe("");
    expect(formatInTimeZone(iso, "Not/AZone", "en-US")).not.toBe(iso);
  });

  it("hands back an unreadable timestamp instead of throwing", () => {
    expect(formatInTimeZone("not-a-date", "UTC", "en-US")).toBe("not-a-date");
  });
});

describe("countdownDiff", () => {
  const now = new Date("2026-07-14T00:00:00Z");

  it("splits the diff the way the translated strings need it", () => {
    expect(countdownDiff("2026-07-14T00:02:00Z", now)).toEqual({ kind: "minutes", minutes: 2 });
    expect(countdownDiff("2026-07-14T02:05:00Z", now)).toEqual({
      kind: "hours",
      hours: 2,
      minutes: 5,
    });
    expect(countdownDiff("2026-07-16T03:04:00Z", now)).toEqual({
      kind: "days",
      days: 2,
      hours: 3,
      minutes: 4,
    });
  });

  it("marks sub-minute and unreadable timestamps distinctly", () => {
    expect(countdownDiff("2026-07-14T00:00:30Z", now)).toEqual({ kind: "less" });
    expect(countdownDiff("2026-07-14T00:00:00Z", now)).toEqual({ kind: "less" });
    expect(countdownDiff("not-a-date", now)).toBeNull();
  });
});