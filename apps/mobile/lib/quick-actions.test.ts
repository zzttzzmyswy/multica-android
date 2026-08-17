import { describe, expect, it } from "vitest";
import { daysSince, isStaleQuickAction } from "./quick-actions";

describe("daysSince", () => {
  it("returns null for missing or unparseable timestamps", () => {
    expect(daysSince(null)).toBeNull();
    expect(daysSince("")).toBeNull();
    expect(daysSince("not-a-date")).toBeNull();
  });

  it("returns whole days for a valid timestamp", () => {
    const now = Date.now();
    expect(daysSince(new Date(now - 5 * 86_400_000).toISOString())).toBe(5);
    expect(daysSince(new Date(now).toISOString())).toBe(0);
  });
});

describe("isStaleQuickAction", () => {
  const day = 86_400_000;
  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

  it("flags an action unused for 90+ days", () => {
    expect(
      isStaleQuickAction({
        last_used_at: iso(91 * day),
        created_at: iso(200 * day),
      }),
    ).toBe(true);
  });

  it("flags an action exactly at the threshold", () => {
    expect(
      isStaleQuickAction({
        last_used_at: iso(90 * day),
        created_at: iso(90 * day),
      }),
    ).toBe(true);
  });

  it("does not flag a recently used action", () => {
    expect(
      isStaleQuickAction({
        last_used_at: iso(1 * day),
        created_at: iso(100 * day),
      }),
    ).toBe(false);
  });

  it("falls back to created_at when never used", () => {
    expect(
      isStaleQuickAction({
        last_used_at: null,
        created_at: iso(100 * day),
      }),
    ).toBe(true);
    expect(
      isStaleQuickAction({
        last_used_at: null,
        created_at: iso(30 * day),
      }),
    ).toBe(false);
  });
});