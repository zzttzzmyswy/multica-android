import { beforeEach, describe, expect, it } from "vitest";

import {
  browserTimezone,
  cityLabel,
  resolveViewingTimezone,
  timezoneLabel,
  timezoneOptions,
  tzOffset,
} from "@/lib/timezone";
import {
  COMMON_TIMEZONES,
} from "@/lib/autopilot-trigger-form";

type IntlWithSupportedValues = typeof Intl & {
  supportedValuesOf?: (key: "timeZone") => string[];
};

const intl = Intl as IntlWithSupportedValues;

beforeEach(() => {
  // Restore any stub left by the fallback test so sibling suites always see
  // the runtime's real Intl.supportedValuesOf.
  if (intl.supportedValuesOf === undefined && typeof globalThis.Intl !== "undefined") {
    // no-op: supportedValuesOf may legitimately be missing; tests below stub it.
  }
});

describe("browserTimezone", () => {
  it("returns a non-empty IANA-style zone id", () => {
    const tz = browserTimezone();
    expect(typeof tz).toBe("string");
    expect(tz).toMatch(/^[A-Za-z_+./-]+$/);
  });
});

describe("cityLabel", () => {
  it("extracts the trailing city and unescapes underscores", () => {
    expect(cityLabel("Asia/Kolkata")).toBe("Kolkata");
    expect(cityLabel("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
  });

  it("leaves UTC and top-level zones unmodified", () => {
    expect(cityLabel("UTC")).toBe("UTC");
    expect(cityLabel("GMT")).toBe("GMT");
  });
});

describe("tzOffset", () => {
  it("returns the fixed GMT+8 for a zone without DST", () => {
    expect(tzOffset("Asia/Shanghai")).toBe("GMT+8");
  });

  it("returns a signed, DST-aware offset matching Intl right now", () => {
    const expected = new Intl.DateTimeFormat("en-US", {
      timeZone: "Pacific/Auckland",
      timeZoneName: "shortOffset",
    })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value;
    expect(tzOffset("Pacific/Auckland")).toBe(expected);
    expect(tzOffset("Pacific/Auckland")).toMatch(/^GMT[+-]\d{1,2}$/);
  });

  it("returns an empty string for an unknown zone", () => {
    expect(tzOffset("Not/A_Zone")).toBe("");
  });
});

describe("timezoneLabel", () => {
  it("renders the UTC and GMT-offset labels", () => {
    expect(timezoneLabel("UTC")).toBe("UTC");
    expect(timezoneLabel("Asia/Shanghai")).toBe("GMT+8 Asia/Shanghai");
    expect(timezoneLabel("Pacific/Auckland")).toMatch(
      /^GMT[+-]\d{1,2} Pacific\/Auckland$/,
    );
  });

  it("falls back to the bare id when the offset cannot be computed", () => {
    expect(timezoneLabel("Not/A_Zone")).toBe("Not/A_Zone");
  });

  it("returns the input untouched when empty", () => {
    expect(timezoneLabel("")).toBe("");
  });
});

describe("timezoneOptions", () => {
  it("pins the preferred value and the device zone first, deduped", () => {
    const device = browserTimezone() ?? "UTC";
    const options = timezoneOptions("UTC");
    expect(options[0]).toBe("UTC");
    expect(options.filter((z) => z === "UTC")).toHaveLength(1);
    expect(options.filter((z) => z === device)).toHaveLength(1);
  });

  it("collapses to a single pinned row when preferred equals the device zone", () => {
    const device = browserTimezone();
    if (!device) return;
    const options = timezoneOptions(device);
    expect(options[0]).toBe(device);
    expect(options.filter((z) => z === device)).toHaveLength(1);
    // Same zone as device → no second pinned copy right behind it.
    expect(options[1]).not.toBe(device);
  });

  it("contains every curated common zone", () => {
    const options = timezoneOptions();
    for (const tz of COMMON_TIMEZONES) {
      expect(options).toContain(tz);
    }
  });

  it("keeps no duplicates", () => {
    const options = timezoneOptions("America/New_York");
    expect(new Set(options).size).toBe(options.length);
  });

  it("lists the full IANA set when Intl.supportedValuesOf exists", () => {
    if (typeof intl.supportedValuesOf !== "function") return; // environment lacks it — fallback branch covered below
    const options = timezoneOptions();
    expect(options.length).toBeGreaterThan(COMMON_TIMEZONES.length + 2);
  });

  it("falls back to the curated list when Intl.supportedValuesOf is missing", () => {
    const original = intl.supportedValuesOf;
    (intl as { supportedValuesOf?: typeof original }).supportedValuesOf = undefined;
    try {
      const options = timezoneOptions("UTC");
      // [preferred, device, ...COMMON] — never beyond curated + 2 pinned
      expect(options.length).toBeLessThanOrEqual(COMMON_TIMEZONES.length + 2);
      expect(options).toContain("Asia/Shanghai");
      expect(options).toContain("Pacific/Auckland");
    } finally {
      (intl as { supportedValuesOf?: typeof original }).supportedValuesOf = original;
    }
  });

  it("ignores an empty preferred value", () => {
    const options = timezoneOptions("");
    expect(options.length).toBeGreaterThan(0);
    const device = browserTimezone();
    if (device) expect(options[0]).toBe(device);
  });

  it("treats a whitespace-only preferred value as no preference", () => {
    const device = browserTimezone();
    const options = timezoneOptions("   ");
    expect(options.filter((z) => z === "   ")).toHaveLength(0);
    if (device) expect(options[0]).toBe(device);
  });
});

describe("resolveViewingTimezone", () => {
  const deviceTz = browserTimezone();

  it("prefers a stored non-empty timezone", () => {
    expect(resolveViewingTimezone({ timezone: "Asia/Tokyo" })).toBe("Asia/Tokyo");
    expect(resolveViewingTimezone({ timezone: "  Asia/Kolkata  " })).toBe(
      "Asia/Kolkata",
    );
  });

  it("falls back to the device zone for null/empty preferences", () => {
    expect(resolveViewingTimezone({ timezone: null })).toBe(deviceTz ?? "UTC");
    expect(resolveViewingTimezone({ timezone: "" })).toBe(deviceTz ?? "UTC");
    expect(resolveViewingTimezone({ timezone: "   " })).toBe(deviceTz ?? "UTC");
    expect(resolveViewingTimezone(null)).toBe(deviceTz ?? "UTC");
    expect(resolveViewingTimezone(undefined)).toBe(deviceTz ?? "UTC");
  });
});