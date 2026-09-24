import { describe, expect, it } from "vitest";
import {
  formatTzLabel,
  formatUpdatedAt,
  latestUpdatedAt,
} from "./usage-freshness";

// 2026-08-25 12:34Z — 20:34 in Shanghai (UTC+8), 08:34 in New York (UTC-4).
const AT = new Date("2026-08-25T12:34:00Z");

describe("latestUpdatedAt", () => {
  it("takes the most recent stamp", () => {
    expect(latestUpdatedAt([1000, 3000, 2000])).toBe(3000);
  });

  // React Query reports 0 for a query that never resolved; treating that as a
  // timestamp would print 1970.
  it("ignores queries that have not resolved", () => {
    expect(latestUpdatedAt([0, 0, 5000])).toBe(5000);
  });

  it("is null when nothing has resolved", () => {
    expect(latestUpdatedAt([0, 0])).toBeNull();
  });

  it("is null for an empty list", () => {
    expect(latestUpdatedAt([])).toBeNull();
  });

  it("ignores negative and non-finite stamps", () => {
    expect(latestUpdatedAt([-5, Number.NaN, Number.POSITIVE_INFINITY, 42])).toBe(42);
  });
});

describe("formatTzLabel", () => {
  it("names the zone as a short offset", () => {
    expect(formatTzLabel("Asia/Shanghai", "en-US", AT)).toBe("GMT+8");
  });

  it("follows the zone, not the device", () => {
    expect(formatTzLabel("America/New_York", "en-US", AT)).toBe("GMT-4");
  });

  it("returns null for a zone Intl does not recognise", () => {
    expect(formatTzLabel("Not/AZone", "en-US", AT)).toBeNull();
  });

  // The stored preference is user input; an empty string is a plausible value
  // and must degrade rather than throw.
  it("returns null for an empty zone", () => {
    expect(formatTzLabel("", "en-US", AT)).toBeNull();
  });
});

describe("formatUpdatedAt", () => {
  it("formats in the viewing zone", () => {
    expect(formatUpdatedAt(AT.getTime(), "Asia/Shanghai", "en-GB")).toBe("20:34");
  });

  it("is null when no query has resolved", () => {
    expect(formatUpdatedAt(null, "Asia/Shanghai", "en-GB")).toBeNull();
  });

  it("returns null for a zone Intl does not recognise", () => {
    expect(formatUpdatedAt(AT.getTime(), "Not/AZone", "en-GB")).toBeNull();
  });
});
