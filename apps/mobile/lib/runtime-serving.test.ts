import { describe, expect, it } from "vitest";
import type { AgentPresenceDetail } from "@multica/core/agents";
import type { Agent } from "@multica/core/types";
import { buildServingAgents } from "./runtime-serving";

function agent(over: Partial<Agent> & { id: string }): Agent {
  return {
    runtime_id: "rt-1",
    name: over.id,
    archived_at: null,
    ...over,
  } as Agent;
}

function presence(
  over: Partial<AgentPresenceDetail> = {},
): AgentPresenceDetail {
  return {
    availability: "online",
    workload: "idle",
    runningCount: 0,
    queuedCount: 0,
    capacity: 1,
    ...over,
  };
}

describe("buildServingAgents", () => {
  it("keeps only agents bound to this runtime", () => {
    const rows = buildServingAgents(
      [
        agent({ id: "a-bound" }),
        agent({ id: "b-elsewhere", runtime_id: "rt-2" }),
        // An agent that never bound a runtime carries an empty id, not null
        // (Agent.runtime_id is a plain string; see isAgentRuntimeBound).
        agent({ id: "c-unbound", runtime_id: "" }),
      ],
      "rt-1",
      new Map(),
    );
    expect(rows.map((r) => r.id)).toEqual(["a-bound"]);
  });

  it("drops archived agents even though they keep their runtime_id", () => {
    // A retired agent still carries runtime_id; listing it would advertise
    // capacity that can never take work (web filters the same way).
    const rows = buildServingAgents(
      [
        agent({ id: "a-live" }),
        agent({ id: "b-retired", archived_at: "2026-08-01T00:00:00Z" }),
      ],
      "rt-1",
      new Map(),
    );
    expect(rows.map((r) => r.id)).toEqual(["a-live"]);
  });

  it("preserves the server's list order rather than sorting", () => {
    const rows = buildServingAgents(
      [
        agent({ id: "z", name: "Zeta" }),
        agent({ id: "a", name: "Alpha" }),
      ],
      "rt-1",
      new Map(),
    );
    expect(rows.map((r) => r.name)).toEqual(["Zeta", "Alpha"]);
  });

  it("returns nothing for a missing runtime id", () => {
    const agents = [agent({ id: "a" })];
    expect(buildServingAgents(agents, null, new Map())).toEqual([]);
    expect(buildServingAgents(agents, undefined, new Map())).toEqual([]);
    expect(buildServingAgents(agents, "", new Map())).toEqual([]);
  });

  it("joins presence: availability, workload and the running/queued split", () => {
    const rows = buildServingAgents(
      [agent({ id: "a", name: "Scout" })],
      "rt-1",
      new Map([
        [
          "a",
          presence({
            availability: "unstable",
            workload: "working",
            runningCount: 2,
            queuedCount: 3,
          }),
        ],
      ]),
    );
    expect(rows[0]).toMatchObject({
      id: "a",
      name: "Scout",
      availability: "unstable",
      workload: "working",
      runningCount: 2,
      queuedCount: 3,
    });
  });

  it("falls back to offline + idle when presence has not resolved", () => {
    // Absent from the map ≠ unknown: the agent is bound but unreachable, which
    // is the same read the availability dot would give for a missing runtime.
    const rows = buildServingAgents([agent({ id: "a" })], "rt-1", new Map());
    expect(rows[0]).toMatchObject({
      availability: "offline",
      workload: "idle",
      runningCount: 0,
      queuedCount: 0,
      showWorkload: false,
    });
  });

  it("hides the workload chip only when idle", () => {
    const map = new Map([
      ["idle", presence({ workload: "idle" })],
      ["working", presence({ workload: "working", runningCount: 1 })],
      ["queued", presence({ workload: "queued", queuedCount: 4 })],
    ]);
    const rows = buildServingAgents(
      [agent({ id: "idle" }), agent({ id: "working" }), agent({ id: "queued" })],
      "rt-1",
      map,
    );
    expect(rows.map((r) => [r.id, r.showWorkload])).toEqual([
      ["idle", false],
      ["working", true],
      ["queued", true],
    ]);
  });
});
