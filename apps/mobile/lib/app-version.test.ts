import { describe, expect, it } from "vitest";
import { compareVersions, orderVersions, parseVersionSegments } from "./app-version";

describe("compareVersions", () => {
  it("compares numerically segment by segment, not lexically", () => {
    expect(compareVersions("0.1.0", "0.10.0")).toBe(-1);
    expect(compareVersions("0.10.0", "0.1.0")).toBe(1);
    expect(compareVersions("1.9.9", "2.0.0")).toBe(-1);
    expect(compareVersions("2.0.0", "1.99.99")).toBe(1);
  });

  it("returns 0 for equal semantic versions", () => {
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("tolerates a leading v prefix", () => {
    expect(compareVersions("v0.1.1", "0.1.0")).toBe(1);
    expect(compareVersions("v0.1.0", "0.1.0")).toBe(0);
  });

  it("treats missing trailing segments as zero", () => {
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0", "1.0.1")).toBe(-1);
  });

  it("ignores prerelease/build suffixes for the comparison", () => {
    expect(compareVersions("1.0.0-beta", "1.0.0")).toBe(0);
    expect(compareVersions("0.1.0+build7", "0.1.0")).toBe(0);
    expect(compareVersions("1.1.0-rc.1", "1.0.9")).toBe(1);
  });

  it("returns 0 for inputs that are not version strings", () => {
    expect(compareVersions("", "0.1.0")).toBe(0);
    expect(compareVersions("abc", "0.1.0")).toBe(0);
    expect(compareVersions("1.2.x", "1.2.0")).toBe(0);
    expect(compareVersions("0.1.0", "wat")).toBe(0);
  });

  /**
   * The Android release channel tags `mobile-v*` (decoupled from main's `v*`
   * cadence). The prefix landed at mobile-v0.6.59 on 2026-10-11 and the parser
   * of the day read every one of them as unparseable — which `compareVersions`
   * reported as `0`, i.e. "you're on the latest version", for ~40 releases.
   */
  it("reads namespaced mobile-v tags", () => {
    expect(parseVersionSegments("mobile-v0.6.83")).toEqual([0, 6, 83]);
    expect(compareVersions("mobile-v0.6.83", "0.6.43")).toBe(1);
    expect(compareVersions("mobile-v0.6.43", "0.6.43")).toBe(0);
    expect(compareVersions("mobile-v0.6.42", "0.6.43")).toBe(-1);
  });

  it("crosses the prefix change on 2026-10-11 in both directions", () => {
    // v0.6.58 (bare) → mobile-v0.6.59 (namespaced): an install from before the
    // change must still see the next release as newer.
    expect(compareVersions("mobile-v0.6.59", "0.6.58")).toBe(1);
    // And a namespaced install must still order against a bare tag, should the
    // channel ever revert.
    expect(compareVersions("v0.6.60", "0.6.59")).toBe(1);
  });

  it("reads other namespace spellings without depending on the exact name", () => {
    expect(parseVersionSegments("android-release-v1.2.3")).toEqual([1, 2, 3]);
    expect(parseVersionSegments("mobile-v0.6.83-rc.1")).toEqual([0, 6, 83]);
    expect(parseVersionSegments("mobile-v0.6.83+build7")).toEqual([0, 6, 83]);
    expect(compareVersions("MOBILE-V0.7.0", "mobile-v0.6.83")).toBe(1);
  });

  /**
   * The `v` marker is common but not guaranteed. Pinning the no-`v` spelling
   * keeps the parser keyed on "namespace segments, then digits" rather than on
   * the exact `mobile-v` prefix — a channel that renamed itself to
   * `mobile-0.6.84` tomorrow would otherwise go dark the same silent way.
   */
  it("reads a namespaced tag whose version carries no v marker", () => {
    expect(parseVersionSegments("mobile-0.6.83")).toEqual([0, 6, 83]);
    expect(compareVersions("mobile-0.6.83", "0.6.43")).toBe(1);
    expect(compareVersions("android-release-1.2.3", "1.2.2")).toBe(1);
  });

  it("still rejects strings with no leading numeric version", () => {
    expect(parseVersionSegments("mobile-v")).toBeNull();
    expect(parseVersionSegments("mobile-latest")).toBeNull();
    expect(parseVersionSegments("-v0.6.83")).toBeNull();
    expect(parseVersionSegments("v")).toBeNull();
  });
});

describe("orderVersions", () => {
  it("agrees with compareVersions whenever both sides are readable", () => {
    const pairs: Array<[string, string]> = [
      ["mobile-v0.6.83", "0.6.43"],
      ["v0.1.0", "0.1.0"],
      ["1.0", "1.0.1"],
    ];
    for (const [a, b] of pairs) {
      expect(orderVersions(a, b)).toBe(compareVersions(a, b));
    }
  });

  /**
   * The whole reason this function exists: `compareVersions` maps "unreadable"
   * and "equal" both onto 0, so a caller cannot tell "you are current" from
   * "I could not read the published tag". `orderVersions` keeps them apart.
   */
  it("reports unreadable as null rather than as equal", () => {
    expect(orderVersions("not-a-version", "0.1.0")).toBeNull();
    expect(orderVersions("0.1.0", "wat")).toBeNull();
    expect(orderVersions("", "0.1.0")).toBeNull();
    // ...while a genuine tie is still a real 0.
    expect(orderVersions("0.1.0", "0.1.0")).toBe(0);
  });
});
