/**
 * Release-version comparison helpers for the machine CLI update section
 * (iteration-83, A2.4) — mirrors web
 * `packages/views/runtimes/components/update-section.tsx`'s
 * `parseReleaseVersion` / `isNewer` semantics 1:1: a release tag parses into
 * comparable parts; a git-describe / dev string that cannot be ordered
 * against a release tag compares as "no update available" / "not latest".
 */
import { describe, expect, it } from "vitest";
import { isNewer, parseReleaseVersion } from "./cli-version";

describe("parseReleaseVersion", () => {
  it("parses a leading-v release tag", () => {
    expect(parseReleaseVersion("v0.4.17")).toEqual([0, 4, 17]);
  });

  it("parses a bare release tag", () => {
    expect(parseReleaseVersion("0.4.17")).toEqual([0, 4, 17]);
  });

  it("parses a 10+ patch so component-wise ordering stays numeric", () => {
    expect(parseReleaseVersion("0.4.10")).toEqual([0, 4, 10]);
  });

  it("rejects a git-describe dev build (cannot be ordered)", () => {
    expect(parseReleaseVersion("v0.4.17-12-gabc1234")).toBeNull();
  });

  it("rejects the ldflags dev default", () => {
    expect(parseReleaseVersion("dev")).toBeNull();
  });

  it("rejects two-component and non-numeric versions", () => {
    expect(parseReleaseVersion("0.4")).toBeNull();
    expect(parseReleaseVersion("0.4.x")).toBeNull();
    expect(parseReleaseVersion("0.4.17-beta")).toBeNull();
  });

  it("rejects empty and whitespace-only strings", () => {
    expect(parseReleaseVersion("")).toBeNull();
    expect(parseReleaseVersion("  ")).toBeNull();
  });
});

describe("isNewer", () => {
  it("reports an upgrade when latest bumps a component", () => {
    expect(isNewer("0.5.0", "0.4.17")).toBe(true);
    expect(isNewer("0.4.18", "0.4.17")).toBe(true);
    expect(isNewer("0.4.17", "0.4.16")).toBe(true);
  });

  it("reports no upgrade for equal or older latest", () => {
    expect(isNewer("0.4.17", "0.4.17")).toBe(false);
    expect(isNewer("0.4.16", "0.4.17")).toBe(false);
    expect(isNewer("0.3.99", "0.4.17")).toBe(false);
  });

  it("accepts leading-v on either side", () => {
    expect(isNewer("v0.4.18", "0.4.17")).toBe(true);
    expect(isNewer("0.4.18", "v0.4.17")).toBe(true);
  });

  it("does not claim an upgrade when either side is unorderable (MUL-...)", () => {
    // NaN comparisons were always false in the old component scan, so it fell
    // through and reported an upgrade for a version it never read. A source
    // build (git describe / dev) is not a claim we can make either way.
    expect(isNewer("0.4.18", "dev")).toBe(false);
    expect(isNewer("0.4.18", "v0.4.17-12-gabc1234")).toBe(false);
    expect(isNewer("dev", "0.4.17")).toBe(false);
    expect(isNewer("", "0.4.17")).toBe(false);
    expect(isNewer("0.4.18", "")).toBe(false);
  });
});