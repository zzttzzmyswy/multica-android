import { describe, expect, it } from "vitest";
import {
  buildEventFilter,
  canAddFilter,
  parseActionsText,
  serializeEventFilters,
} from "./autopilot-event-filter";
import type { WebhookEventFilter } from "@multica/core/types";

describe("serializeEventFilters", () => {
  it("normalizes omitted vs explicit-empty actions to the same string", () => {
    const omitted: WebhookEventFilter[] = [{ event: "workflow_run" }];
    const explicit: WebhookEventFilter[] = [{ event: "workflow_run", actions: [] }];
    expect(serializeEventFilters(omitted)).toBe(
      serializeEventFilters(explicit),
    );
  });

  it("is stable across order-sensitive JSON input", () => {
    const a: WebhookEventFilter[] = [
      { event: "issue", actions: ["created"] },
      { event: "comment" },
    ];
    const b: WebhookEventFilter[] = [
      { event: "issue", actions: ["created"] },
      { event: "comment", actions: [] },
    ];
    expect(serializeEventFilters(a)).toBe(serializeEventFilters(b));
  });

  it("round-trips a built filter back to its own serialization", () => {
    const filter = buildEventFilter(" workflow_run ", " completed , failed ");
    expect(filter).toEqual({
      event: "workflow_run",
      actions: ["completed", "failed"],
    });
    expect(filter).not.toBeNull();
    expect(serializeEventFilters([filter as WebhookEventFilter])).toBe(
      JSON.stringify([{ event: "workflow_run", actions: ["completed", "failed"] }]),
    );
  });
});

describe("parseActionsText", () => {
  it("splits on commas, trims, and drops empties", () => {
    expect(parseActionsText(" completed , failed ")).toEqual([
      "completed",
      "failed",
    ]);
  });

  it("returns [] for blank or comma-only input", () => {
    expect(parseActionsText("")).toEqual([]);
    expect(parseActionsText("  , , ")).toEqual([]);
  });

  it("keeps a single action", () => {
    expect(parseActionsText("queued")).toEqual(["queued"]);
  });
});

describe("buildEventFilter", () => {
  it("builds a filter with actions when present", () => {
    expect(buildEventFilter("workflow_run", "completed, failed")).toEqual({
      event: "workflow_run",
      actions: ["completed", "failed"],
    });
  });

  it("omits the actions key when the actions text is blank", () => {
    expect(buildEventFilter("issue", "  ")).toEqual({ event: "issue" });
  });

  it("returns null for a blank event", () => {
    expect(buildEventFilter("  ", "completed")).toBeNull();
  });
});

describe("canAddFilter", () => {
  it("requires a non-blank event", () => {
    expect(canAddFilter("workflow_run")).toBe(true);
    expect(canAddFilter("  ")).toBe(false);
    expect(canAddFilter("")).toBe(false);
  });
});