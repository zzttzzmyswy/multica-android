/**
 * Attribution predicates (MUL-4302 §9). The cases worth pinning are the ones
 * that differ from a naive reading of the server's `precise` flag: an unknown
 * source level must degrade to its raw label rather than blank, `backfill`
 * must NOT warn despite being non-precise, and a missing `initiator` must
 * silence the affordance so no dangling separator is left behind.
 */
import { describe, expect, it } from "vitest";
import type { TaskAttribution } from "@multica/core/types";
import {
  attributionShouldRender,
  attributionSourceLabelKey,
  isAttributionUncertain,
} from "./task-attribution";

function attribution(over: Partial<TaskAttribution> = {}): TaskAttribution {
  return { source: "direct_human", precise: true, ...over };
}

describe("attributionSourceLabelKey", () => {
  it("maps all eight waterfall levels to their agents.activity keys", () => {
    expect(attributionSourceLabelKey("direct_human")).toBe(
      "agents.activity.attribution.sourceDirectHuman",
    );
    expect(attributionSourceLabelKey("delegation")).toBe(
      "agents.activity.attribution.sourceDelegation",
    );
    expect(attributionSourceLabelKey("comment_source")).toBe(
      "agents.activity.attribution.sourceCommentSource",
    );
    expect(attributionSourceLabelKey("trigger_owner")).toBe(
      "agents.activity.attribution.sourceTriggerOwner",
    );
    expect(attributionSourceLabelKey("rule_owner")).toBe(
      "agents.activity.attribution.sourceRuleOwner",
    );
    expect(attributionSourceLabelKey("owner_fallback")).toBe(
      "agents.activity.attribution.sourceOwnerFallback",
    );
    expect(attributionSourceLabelKey("backfill")).toBe(
      "agents.activity.attribution.sourceBackfill",
    );
    expect(attributionSourceLabelKey("unattributed")).toBe(
      "agents.activity.attribution.sourceUnattributed",
    );
  });

  it("returns null for a level this build does not know, so the caller can print the raw source", () => {
    expect(attributionSourceLabelKey("some_future_level")).toBeNull();
    expect(attributionSourceLabelKey("")).toBeNull();
  });
});

describe("isAttributionUncertain", () => {
  it("warns for a non-precise source that could name the wrong human", () => {
    expect(isAttributionUncertain(attribution({ source: "owner_fallback", precise: false }))).toBe(true);
    expect(isAttributionUncertain(attribution({ source: "unattributed", precise: false }))).toBe(true);
  });

  it("does NOT warn for backfill — a historical record whose name is still correct", () => {
    expect(isAttributionUncertain(attribution({ source: "backfill", precise: false }))).toBe(false);
  });

  it("does not warn for a precise source", () => {
    expect(isAttributionUncertain(attribution({ source: "direct_human", precise: true }))).toBe(false);
  });

  it("treats a missing precise flag as confident, not as a degraded source", () => {
    expect(isAttributionUncertain(attribution({ source: "direct_human", precise: undefined }))).toBe(false);
  });

  it("warns for a future unknown non-precise source (fail-safe)", () => {
    expect(isAttributionUncertain(attribution({ source: "brand_new_level", precise: false }))).toBe(true);
  });

  it("is false without an attribution at all (older backend)", () => {
    expect(isAttributionUncertain(undefined)).toBe(false);
  });
});

describe("attributionShouldRender", () => {
  it("renders when a human resolved", () => {
    expect(attributionShouldRender(attribution({ initiator: { id: "u1", name: "MYSWY" } }))).toBe(true);
  });

  it("stays silent without an initiator — even when `source` is unattributed and precise is false", () => {
    expect(attributionShouldRender(attribution({ source: "unattributed", precise: false }))).toBe(false);
  });

  it("stays silent when the task carries no attribution (older backend)", () => {
    expect(attributionShouldRender(undefined)).toBe(false);
  });
});
