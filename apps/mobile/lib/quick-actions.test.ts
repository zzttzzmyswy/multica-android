import { describe, expect, it } from "vitest";
import type { QuickAction } from "@multica/core/types";
import {
  daysSince,
  filterQuickActions,
  isStaleQuickAction,
} from "./quick-actions";

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
describe("filterQuickActions", () => {
  const actions = [
    { id: "1", name: "Deploy staging", target_name: "deploy-bot" },
    { id: "2", name: "Summarise inbox", target_name: "triage-agent" },
    { id: "3", name: "Nightly report", target_name: null },
  ] as unknown as QuickAction[];

  it("returns everything for an empty or whitespace query", () => {
    expect(filterQuickActions(actions, "")).toHaveLength(3);
    expect(filterQuickActions(actions, "   ")).toHaveLength(3);
  });

  it("matches on the action name, case-insensitively", () => {
    expect(filterQuickActions(actions, "deploy").map((a) => a.id)).toEqual(["1"]);
    expect(filterQuickActions(actions, "DEPLOY").map((a) => a.id)).toEqual(["1"]);
  });

  it("matches on the bound target's display name", () => {
    // The target is what the user tends to remember; the name is often a
    // private label from months ago.
    expect(filterQuickActions(actions, "triage").map((a) => a.id)).toEqual(["2"]);
  });

  it("never matches a null target", () => {
    expect(filterQuickActions(actions, "null")).toEqual([]);
  });

  it("returns nothing when neither field matches", () => {
    expect(filterQuickActions(actions, "zzz")).toEqual([]);
  });

  it("does not mutate the input", () => {
    const input = [...actions];
    filterQuickActions(input, "deploy");
    expect(input).toEqual(actions);
  });
});
