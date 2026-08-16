import { describe, expect, it } from "vitest";
import { compareVersions } from "./app-version";

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
});