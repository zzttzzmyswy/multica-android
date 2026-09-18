import { describe, expect, it } from "vitest";
import type { Agent } from "@multica/core/types";
import { isAgentArchived, resolveSessionAgent } from "./chat-session-agent";

function agent(over: Partial<Agent> & { id: string }): Agent {
  return {
    name: over.id,
    archived_at: null,
    ...over,
  } as Agent;
}

const LIVE = agent({ id: "live", name: "Live" });
const RETIRED = agent({
  id: "retired",
  name: "Retired",
  archived_at: "2026-09-19T03:12:30+08:00",
});

describe("resolveSessionAgent", () => {
  it("resolves a live agent", () => {
    expect(resolveSessionAgent([LIVE, RETIRED], "live")).toBe(LIVE);
  });

  it("resolves an archived agent — the whole point of the archived-inclusive list", () => {
    // Resolving from the *available* list (archived filtered out) would return
    // null here and the session would lose its identity. Web resolves from the
    // full list for exactly this reason.
    expect(resolveSessionAgent([LIVE, RETIRED], "retired")).toBe(RETIRED);
  });

  it("returns null for an id that is in neither list", () => {
    expect(resolveSessionAgent([LIVE], "gone")).toBeNull();
  });

  it("returns null for a missing / null / empty agent id", () => {
    expect(resolveSessionAgent([LIVE], null)).toBeNull();
    expect(resolveSessionAgent([LIVE], undefined)).toBeNull();
    expect(resolveSessionAgent([LIVE], "")).toBeNull();
  });

  it("returns null on an empty list rather than throwing", () => {
    expect(resolveSessionAgent([], "live")).toBeNull();
  });
});

describe("isAgentArchived", () => {
  it("is false for a live agent", () => {
    expect(isAgentArchived(LIVE)).toBe(false);
  });

  it("is true for an archived agent", () => {
    expect(isAgentArchived(RETIRED)).toBe(true);
  });

  it("is false for a null / undefined agent — no session agent is not 'archived'", () => {
    // The distinction matters: the banner slot falls through to the
    // runtime-required / offline branches when there is no agent at all.
    expect(isAgentArchived(null)).toBe(false);
    expect(isAgentArchived(undefined)).toBe(false);
  });

  it("treats an empty-string archived_at as live", () => {
    expect(isAgentArchived(agent({ id: "x", archived_at: "" }))).toBe(false);
  });
});
