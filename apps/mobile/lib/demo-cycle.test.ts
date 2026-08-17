import { describe, expect, it } from "vitest";
import {
  DEMO_ASSIGNEE_CYCLE,
  DEMO_PRIORITY_CYCLE,
  DEMO_STATUS_CYCLE,
  nextAssignee,
  nextOfCycle,
  nextPriority,
  nextStatus,
} from "./demo-cycle";

describe("demo cycle helpers", () => {
  it("cycles statuses forward and wraps around", () => {
    let status: (typeof DEMO_STATUS_CYCLE)[number] = "todo";
    const seen: string[] = [];
    for (let i = 0; i < DEMO_STATUS_CYCLE.length; i++) {
      seen.push(status);
      status = nextStatus(status);
    }
    expect(seen).toEqual(["todo", "in_progress", "in_review", "done", "backlog"]);
    expect(status).toBe("todo"); // wrapped
  });

  it("cycles priorities forward and wraps around", () => {
    let priority: (typeof DEMO_PRIORITY_CYCLE)[number] = "none";
    const seen: string[] = [];
    for (let i = 0; i < DEMO_PRIORITY_CYCLE.length; i++) {
      seen.push(priority);
      priority = nextPriority(priority);
    }
    expect(seen).toEqual(["none", "low", "medium", "high", "urgent"]);
    expect(priority).toBe("none"); // wrapped
  });

  it("cycles assignees through unassigned → members → agents and wraps", () => {
    const names: string[] = [];
    let assignee = DEMO_ASSIGNEE_CYCLE[0]!;
    for (let i = 0; i < DEMO_ASSIGNEE_CYCLE.length; i++) {
      names.push(assignee.kind === "unassigned" ? "unassigned" : assignee.name);
      assignee = nextAssignee(assignee);
    }
    expect(names).toEqual(["unassigned", "Alex Rivera", "Sarah Kim", "Claude", "Tina-dev"]);
    expect(assignee).toEqual({ kind: "unassigned" }); // wrapped
  });

  it("nextOfCycle handles single-element and foreign values defensively", () => {
    expect(nextOfCycle(["a"] as const, "a")).toBe("a");
    // Unknown current falls back to the first element instead of crashing.
    expect(nextOfCycle(DEMO_STATUS_CYCLE, "cancelled" as never)).toBe("todo");
  });
});