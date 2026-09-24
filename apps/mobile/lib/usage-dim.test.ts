import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildWeekShells,
  chartFetchDays,
  dailyCutoffIso,
  dimsForDays,
  effectiveDim,
  trimToWindow,
  weekCountForDays,
} from "./usage-dim";

// FROZEN_DAY = Tue 2026-08-25 12:00Z → the current week starts Mon 2026-08-24.
const FROZEN_DAY = "2026-08-25T12:00:00Z";

describe("usage dim helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_DAY));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Web TIME_RANGES parity: 1d / 7d at the weekly grain collapse to a single
  // bar, 180d at the daily grain is 180 unreadable bars.
  describe("dimsForDays", () => {
    it("offers only daily for the ranges that cannot be read weekly", () => {
      expect(dimsForDays(1)).toEqual(["daily"]);
      expect(dimsForDays(7)).toEqual(["daily"]);
    });

    it("offers both grains for the ranges wide enough for either", () => {
      expect(dimsForDays(30)).toEqual(["daily", "weekly"]);
      expect(dimsForDays(90)).toEqual(["daily", "weekly"]);
    });

    it("offers only weekly for the widest range", () => {
      expect(dimsForDays(180)).toEqual(["weekly"]);
    });

    it("falls back to daily for a range it does not know", () => {
      expect(dimsForDays(14)).toEqual(["daily"]);
      expect(dimsForDays(0)).toEqual(["daily"]);
    });
  });

  // The card-scoped control must never rewrite the page-scoped range, so the
  // drawn grain is derived per render instead of corrected in state: 30d →
  // 1d → 30d has to restore the reader's choice rather than forget it.
  describe("effectiveDim", () => {
    it("keeps the reader's choice while the range allows it", () => {
      expect(effectiveDim(["daily", "weekly"], "weekly")).toBe("weekly");
      expect(effectiveDim(["daily", "weekly"], "daily")).toBe("daily");
    });

    it("falls back to the first allowed grain when the range disallows the choice", () => {
      expect(effectiveDim(["daily"], "weekly")).toBe("daily");
      expect(effectiveDim(["weekly"], "daily")).toBe("weekly");
    });
  });

  describe("weekCountForDays", () => {
    it("rounds a window up to whole calendar weeks", () => {
      expect(weekCountForDays(1)).toBe(1);
      expect(weekCountForDays(7)).toBe(1);
      expect(weekCountForDays(30)).toBe(5);
      expect(weekCountForDays(90)).toBe(13);
      expect(weekCountForDays(180)).toBe(26);
    });

    it("never returns zero weeks", () => {
      expect(weekCountForDays(0)).toBe(1);
    });
  });

  // Weekly bars need the whole calendar week the window starts inside, or the
  // leftmost bar is silently truncated. The over-fetch is what pays for it.
  describe("chartFetchDays", () => {
    it("fetches a whole number of weeks covering the window", () => {
      expect(chartFetchDays(1)).toBe(7);
      expect(chartFetchDays(7)).toBe(7);
      expect(chartFetchDays(30)).toBe(35);
      expect(chartFetchDays(90)).toBe(91);
      expect(chartFetchDays(180)).toBe(182);
    });

    it("never fetches fewer days than the window asks for", () => {
      for (const days of [1, 7, 30, 90, 180]) {
        expect(chartFetchDays(days)).toBeGreaterThanOrEqual(days);
      }
    });
  });

  // Anchored on the viewer's timezone — the same axis the server slices its
  // day buckets on — so the trim lands on the server's calendar boundary.
  describe("dailyCutoffIso", () => {
    it("is the oldest day of an inclusive `days` window", () => {
      expect(dailyCutoffIso(1, "UTC")).toBe("2026-08-25");
      expect(dailyCutoffIso(7, "UTC")).toBe("2026-08-19");
      expect(dailyCutoffIso(30, "UTC")).toBe("2026-07-27");
    });

    it("follows the viewer's zone across the date line", () => {
      // 2026-08-25T12:00Z is already Wed the 26th in Kiritimati (UTC+14) and
      // still Tue the 25th in Honolulu (UTC-10). A 1d window means "today"
      // there, not "the last 24 hours".
      expect(dailyCutoffIso(1, "Pacific/Kiritimati")).toBe("2026-08-26");
      expect(dailyCutoffIso(1, "Pacific/Honolulu")).toBe("2026-08-25");
    });
  });

  describe("trimToWindow", () => {
    it("keeps the cutoff day and drops everything older", () => {
      const rows = [
        { date: "2026-08-18" },
        { date: "2026-08-19" },
        { date: "2026-08-25" },
      ];
      expect(trimToWindow(rows, "2026-08-19")).toEqual([
        { date: "2026-08-19" },
        { date: "2026-08-25" },
      ]);
    });

    it("leaves an already-trimmed list alone", () => {
      const rows = [{ date: "2026-08-25" }];
      expect(trimToWindow(rows, "2026-08-19")).toEqual(rows);
    });
  });

  describe("buildWeekShells", () => {
    it("builds trailing Mon-start weeks ending at the current one", () => {
      const shells = buildWeekShells("UTC", 3);
      expect(shells.map((s) => s.weekStart)).toEqual([
        "2026-08-10",
        "2026-08-17",
        "2026-08-24",
      ]);
      expect(shells.map((s) => s.weekEnd)).toEqual([
        "2026-08-16",
        "2026-08-23",
        "2026-08-30",
      ]);
    });

    it("marks the running week partial and counts its elapsed days", () => {
      const shells = buildWeekShells("UTC", 3);
      // Today is Tuesday, so the current week has 2 of 7 days elapsed.
      expect(shells[2]).toMatchObject({ partial: true, daysCovered: 2 });
      expect(shells[0]).toMatchObject({ partial: false, daysCovered: 7 });
      expect(shells[1]).toMatchObject({ partial: false, daysCovered: 7 });
    });

    it("always builds at least one shell", () => {
      expect(buildWeekShells("UTC", 0)).toHaveLength(1);
      expect(buildWeekShells("UTC", -5)).toHaveLength(1);
    });

    it("anchors the current week on the viewer's zone", () => {
      // Sun 2026-08-23 11:00Z is already Mon the 24th in Kiritimati, so the
      // current week there starts a week later than it does in UTC.
      vi.setSystemTime(new Date("2026-08-23T11:00:00Z"));
      expect(buildWeekShells("UTC", 1)[0]!.weekStart).toBe("2026-08-17");
      expect(buildWeekShells("Pacific/Kiritimati", 1)[0]!.weekStart).toBe("2026-08-24");
    });
  });
});
