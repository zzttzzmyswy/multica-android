import { describe, expect, it } from "vitest";
import type { Agent, AgentSkillSummary } from "@multica/core/types";
import { agentsForSkill, partitionAgentsForSkill } from "./skill-used-by";

function skill(id: string): AgentSkillSummary {
  return { id, name: `Skill ${id}`, description: "" };
}

function agent(overrides: Partial<Agent>): Agent {
  return {
    id: "a",
    name: "Agent",
    description: null,
    workspace_id: "ws",
    avatar_url: null,
    emoji: null,
    skills: [],
    archived_at: null,
    owner_id: "user-1",
    ...overrides,
  } as Agent;
}

describe("agentsForSkill", () => {
  it("returns active agents bound to the skill, in list order", () => {
    const s = skill("s1");
    const list = [
      agent({ id: "a1", name: "Bound", skills: [s] }),
      agent({ id: "a2", name: "Other", skills: [skill("s2")] }),
      agent({ id: "a3", name: "Bound too", skills: [skill("s2"), s] }),
    ];
    expect(agentsForSkill(list, "s1").map((a) => a.id)).toEqual(["a1", "a3"]);
  });

  it("skips archived agents (same as web selectSkillAssignments)", () => {
    const s = skill("s1");
    const list = [
      agent({ id: "live", skills: [s] }),
      agent({ id: "arch", skills: [s], archived_at: "2026-01-01T00:00:00Z" }),
    ];
    expect(agentsForSkill(list, "s1").map((a) => a.id)).toEqual(["live"]);
  });
});

describe("partitionAgentsForSkill", () => {
  const mine = agent({ id: "mine", owner_id: "user-1", name: "Mine" });
  const otherOwned = agent({
    id: "other-owned",
    owner_id: "user-2",
    name: "Their agent",
  });
  const unowned = agent({ id: "unowned", owner_id: null, name: "Workspace" });

  it("members see only their own active agents", () => {
    const { mine: m, others } = partitionAgentsForSkill(
      [mine, otherOwned, unowned],
      "user-1",
      false,
    );
    expect(m.map((a) => a.id)).toEqual(["mine"]);
    expect(others).toEqual([]);
  });

  it("admins additionally see other-owned and unowned agents", () => {
    const { mine: m, others } = partitionAgentsForSkill(
      [mine, otherOwned, unowned],
      "user-1",
      true,
    );
    expect(m.map((a) => a.id)).toEqual(["mine"]);
    expect(others.map((a) => a.id)).toEqual(["other-owned", "unowned"]);
  });

  it("excludes archived agents from both groups", () => {
    const archived = agent({
      id: "arch",
      owner_id: "user-2",
      archived_at: "2026-01-01T00:00:00Z",
    });
    const { mine: m, others } = partitionAgentsForSkill(
      [archived, mine],
      "user-1",
      true,
    );
    expect(m.map((a) => a.id)).toEqual(["mine"]);
    expect(others).toEqual([]);
  });

  it("excludes already-bound agents from the add sheet rows", () => {
    const bound = agent({
      id: "bound",
      owner_id: "user-1",
      skills: [skill("s1")],
    });
    const { mine: m } = partitionAgentsForSkill([bound, mine], "user-1", false);
    const addable = m.filter((a) => !a.skills.some((s) => s.id === "s1"));
    expect(addable.map((a) => a.id)).toEqual(["mine"]);
  });
});
