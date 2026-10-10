/**
 * Tests for the agents-working chip's state machine and facet decode.
 *
 * These pin the three distinctions the chip exists to make, each of which was
 * a real bug on web before it was fixed:
 *
 *   - unresolved (`undefined`) must not read as idle (`[]`) — MUL-5525;
 *   - the ON tier must not look like the "there is activity" tier;
 *   - an ABSENT facet must not read as an empty one, or an older deploy would
 *     render "0 agents working" over a list full of them.
 */
import { describe, expect, it } from "vitest";
import type { IssueTableFacet, WorkingAgentSummary } from "@multica/core/types";
import {
  chipActivity,
  chipAppearance,
  workingAgentsFromFacets,
} from "./working-agents-chip";

function agent(id: string, runningTaskCount = 1): WorkingAgentSummary {
  return { id, running_task_count: runningTaskCount };
}

describe("chipActivity — three states, never two", () => {
  it("calls an unresolved projection unknown, not empty", () => {
    expect(chipActivity(undefined)).toBe("unknown");
  });

  it("calls a resolved empty projection none", () => {
    expect(chipActivity([])).toBe("none");
  });

  it("calls a non-empty projection some", () => {
    expect(chipActivity([agent("a")])).toBe("some");
  });

  it("keeps unknown and none distinct — the whole point of the type", () => {
    expect(chipActivity(undefined)).not.toBe(chipActivity([]));
  });
});

describe("chipAppearance — the tiers", () => {
  it("wears the filled brand tier when the filter is on", () => {
    expect(chipAppearance(true, "some").variant).toBe("brand");
    expect(chipAppearance(true, "none").variant).toBe("brand");
    expect(chipAppearance(true, "unknown").variant).toBe("brand");
  });

  it("wears the tint tier when there is activity but no active filter", () => {
    expect(chipAppearance(false, "some").variant).toBe("brandSubtle");
  });

  it("wears neutral and dimmed only for a CONFIRMED idle surface", () => {
    const idle = chipAppearance(false, "none");
    expect(idle.variant).toBe("outline");
    expect(idle.tone).toBe("dimmed");
  });

  it("does NOT dim an unresolved surface", () => {
    // Dimming is the visual claim "nothing is happening here". We do not know
    // that yet, so the unresolved chip stays neutral but undimmed.
    const unknown = chipAppearance(false, "unknown");
    expect(unknown.variant).toBe("outline");
    expect(unknown.tone).toBe("");
  });

  it("leaves the active filter brighter than mere activity", () => {
    expect(chipAppearance(true, "some").variant).not.toBe(
      chipAppearance(false, "some").variant,
    );
  });
});

describe("workingAgentsFromFacets", () => {
  const facet = (
    kind: IssueTableFacet["kind"],
    values: { key: string; count: number }[],
  ): IssueTableFacet => ({ kind, values });

  it("maps agent-id keys and running counts straight through", () => {
    const agents = workingAgentsFromFacets([
      facet("working_agents", [
        { key: "agent-1", count: 2 },
        { key: "agent-2", count: 1 },
      ]),
    ]);
    expect(agents).toEqual([
      { id: "agent-1", running_task_count: 2 },
      { id: "agent-2", running_task_count: 1 },
    ]);
  });

  it("stays INDETERMINATE when the response omits the facet", () => {
    // An older deployment answers without `working_agents`. "Absent" is not
    // "empty": claiming zero there would state something the server never
    // said, so the chip must keep showing its unresolved form.
    expect(workingAgentsFromFacets([])).toBeUndefined();
    expect(workingAgentsFromFacets([facet("status", [])])).toBeUndefined();
    expect(workingAgentsFromFacets(undefined)).toBeUndefined();
  });

  it("treats a present-but-empty facet as a real zero", () => {
    // The facet IS there and listed nobody — that is a resolved "nobody",
    // which is a different claim from the absent case above.
    expect(workingAgentsFromFacets([facet("working_agents", [])])).toEqual([]);
  });

  it("ignores the other dimensions asked for alongside it", () => {
    const agents = workingAgentsFromFacets([
      facet("status", [
        { key: "todo", count: 9 },
        { key: "done", count: 4 },
      ]),
      facet("working_agents", [{ key: "agent-1", count: 1 }]),
    ]);
    expect(agents).toEqual([{ id: "agent-1", running_task_count: 1 }]);
  });
});
