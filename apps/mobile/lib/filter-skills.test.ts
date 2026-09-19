import { describe, expect, it } from "vitest";
import type { Agent, MemberWithUser, SkillSummary } from "@multica/core/types";
import {
  EMPTY_SKILL_FILTERS,
  buildSkillRows,
  countActiveSkillFilterDimensions,
  filterSkillRows,
  matchesSkillSearch,
  parseSkillFilterKey,
  skillFilterKey,
  sortSkillRows,
  toggleSkillFilter,
  type SkillRow,
} from "./filter-skills";

function skill(overrides: Partial<SkillSummary> = {}): SkillSummary {
  return {
    id: "skill-1",
    workspace_id: "ws-1",
    name: "Deploy checklist",
    description: null,
    created_by: "user-1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    config: {},
    ...overrides,
  } as SkillSummary;
}

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    workspace_id: "ws-1",
    name: "Reviewer",
    archived_at: null,
    owner_id: "user-1",
    skills: [{ id: "skill-1", name: "Deploy checklist", description: "" }],
    ...overrides,
  } as Agent;
}

function member(overrides: Partial<MemberWithUser> = {}): MemberWithUser {
  return {
    id: "member-1",
    user_id: "user-1",
    name: "Ada",
    role: "member",
    ...overrides,
  } as MemberWithUser;
}

function row(overrides: Partial<SkillRow> = {}): SkillRow {
  return {
    skill: skill(),
    agents: [],
    creator: null,
    originType: "manual",
    canEdit: true,
    ...overrides,
  };
}

describe("buildSkillRows", () => {
  it("attaches the active agents bound to each skill", () => {
    const rows = buildSkillRows({
      skills: [skill()],
      agents: [
        agent(),
        agent({
          id: "agent-2",
          name: "Builder",
          skills: [{ id: "skill-1", name: "Deploy checklist", description: "" }],
        }),
        // Bound but archived — web's selectSkillAssignments skips these.
        agent({ id: "agent-3", archived_at: "2026-01-01T00:00:00Z" }),
        agent({ id: "agent-4", name: "Unbound", skills: [] }),
      ],
      members: [],
      userId: "user-1",
      role: "member",
    });

    expect(rows[0]!.agents.map((a) => a.id)).toEqual(["agent-1", "agent-2"]);
  });

  it("resolves the creator from the member list and falls back to null", () => {
    const rows = buildSkillRows({
      skills: [skill(), skill({ id: "skill-2", created_by: "user-gone" })],
      agents: [],
      members: [member()],
      userId: "user-1",
      role: "member",
    });

    expect(rows[0]!.creator?.user_id).toBe("user-1");
    expect(rows[1]!.creator).toBeNull();
  });

  it("reads the provenance and the edit guard per row", () => {
    const rows = buildSkillRows({
      skills: [
        skill({ config: { origin: { type: "github", source_url: "u" } } }),
        skill({ id: "skill-2", created_by: "user-2" }),
      ],
      agents: [],
      members: [],
      userId: "user-1",
      role: "member",
    });

    expect(rows[0]!.originType).toBe("github");
    // Not mine and not an admin → read-only.
    expect(rows[1]!.canEdit).toBe(false);
    expect(rows[0]!.canEdit).toBe(true);
  });
});

describe("matchesSkillSearch", () => {
  it("matches the name, case-insensitively, on a trimmed query", () => {
    expect(matchesSkillSearch(row(), "deploy")).toBe(true);
    expect(matchesSkillSearch(row(), "  DEPLOY  ")).toBe(true);
    expect(matchesSkillSearch(row(), "checklist")).toBe(true);
    expect(matchesSkillSearch(row(), "zzz")).toBe(false);
  });

  it("does not match the description — web searches names only", () => {
    expect(
      matchesSkillSearch(row({ skill: skill({ description: "release steps" }) }), "release"),
    ).toBe(false);
  });

  it("treats an empty query as no narrowing", () => {
    expect(matchesSkillSearch(row(), "")).toBe(true);
    expect(matchesSkillSearch(row(), "   ")).toBe(true);
  });
});

describe("filterSkillRows", () => {
  const used = row({
    skill: skill({ id: "s-used", name: "Used one" }),
    agents: [agent()],
    originType: "github",
  });
  const unused = row({
    skill: skill({ id: "s-unused", name: "Unused one", created_by: "user-2" }),
    originType: "manual",
  });

  it("returns the same list untouched when nothing is narrowing", () => {
    const rows = [used, unused];
    expect(filterSkillRows(rows, { search: "", filters: EMPTY_SKILL_FILTERS })).toBe(rows);
  });

  it("filters by usage", () => {
    expect(
      filterSkillRows([used, unused], {
        search: "",
        filters: { ...EMPTY_SKILL_FILTERS, usage: ["unused"] },
      }).map((r) => r.skill.id),
    ).toEqual(["s-unused"]);
  });

  it("filters by origin", () => {
    expect(
      filterSkillRows([used, unused], {
        search: "",
        filters: { ...EMPTY_SKILL_FILTERS, origins: ["github"] },
      }).map((r) => r.skill.id),
    ).toEqual(["s-used"]);
  });

  it("filters by bound agent", () => {
    expect(
      filterSkillRows([used, unused], {
        search: "",
        filters: { ...EMPTY_SKILL_FILTERS, agents: ["agent-1"] },
      }).map((r) => r.skill.id),
    ).toEqual(["s-used"]);
  });

  it("filters by creator, excluding skills with no creator", () => {
    expect(
      filterSkillRows([used, unused], {
        search: "",
        filters: { ...EMPTY_SKILL_FILTERS, creators: ["user-2"] },
      }).map((r) => r.skill.id),
    ).toEqual(["s-unused"]);
  });

  it("applies search and filters together", () => {
    expect(
      filterSkillRows([used, unused], {
        search: "one",
        filters: { ...EMPTY_SKILL_FILTERS, usage: ["used"] },
      }).map((r) => r.skill.id),
    ).toEqual(["s-used"]);
  });
});

describe("sortSkillRows", () => {
  const alpha = row({ skill: skill({ id: "a", name: "Alpha", updated_at: "2026-01-03T00:00:00Z", created_at: "2026-01-01T00:00:00Z" }) });
  const beta = row({ skill: skill({ id: "b", name: "Beta", updated_at: "2026-01-01T00:00:00Z", created_at: "2026-01-03T00:00:00Z" }), agents: [agent(), agent({ id: "agent-2" })] });

  it("sorts by name in both directions", () => {
    expect(sortSkillRows([beta, alpha], "name", "asc").map((r) => r.skill.id)).toEqual(["a", "b"]);
    expect(sortSkillRows([alpha, beta], "name", "desc").map((r) => r.skill.id)).toEqual(["b", "a"]);
  });

  it("sorts by usage count, tie-breaking on name ascending either way", () => {
    const tied = row({ skill: skill({ id: "c", name: "Gamma" }) });
    expect(sortSkillRows([alpha, beta, tied], "usedBy", "desc").map((r) => r.skill.id)).toEqual(["b", "a", "c"]);
    // Ascending still tie-breaks A→Z — web does not scale the tiebreak.
    expect(sortSkillRows([beta, alpha, tied], "usedBy", "asc").map((r) => r.skill.id)).toEqual(["a", "c", "b"]);
  });

  it("sorts by updated and created timestamps", () => {
    expect(sortSkillRows([alpha, beta], "updated", "desc").map((r) => r.skill.id)).toEqual(["a", "b"]);
    expect(sortSkillRows([alpha, beta], "created", "desc").map((r) => r.skill.id)).toEqual(["b", "a"]);
  });

  it("does not reorder the caller's array", () => {
    const rows = [beta, alpha];
    sortSkillRows(rows, "name", "asc");
    expect(rows.map((r) => r.skill.id)).toEqual(["b", "a"]);
  });
});

describe("filter keys", () => {
  it("round-trips a dimension and value", () => {
    expect(parseSkillFilterKey(skillFilterKey("agents", "agent-1"))).toEqual({
      dimension: "agents",
      value: "agent-1",
    });
  });

  it("keeps colons inside the value", () => {
    expect(parseSkillFilterKey("creators:user:1")).toEqual({
      dimension: "creators",
      value: "user:1",
    });
  });

  it("rejects malformed keys", () => {
    expect(parseSkillFilterKey("nope")).toBeNull();
    expect(parseSkillFilterKey(":value")).toBeNull();
    expect(parseSkillFilterKey("agents:")).toBeNull();
    expect(parseSkillFilterKey("unknown:value")).toBeNull();
  });

  it("toggles one value without touching the other dimensions", () => {
    const once = toggleSkillFilter(EMPTY_SKILL_FILTERS, "usage", "used");
    expect(once.usage).toEqual(["used"]);
    const twice = toggleSkillFilter(once, "usage", "used");
    expect(twice.usage).toEqual([]);

    const mixed = toggleSkillFilter(once, "origins", "github");
    expect(mixed.usage).toEqual(["used"]);
    expect(mixed.origins).toEqual(["github"]);
    // The original object is never mutated.
    expect(EMPTY_SKILL_FILTERS.usage).toEqual([]);
  });

  it("counts active dimensions, not active values", () => {
    expect(countActiveSkillFilterDimensions(EMPTY_SKILL_FILTERS)).toBe(0);
    expect(
      countActiveSkillFilterDimensions({
        usage: ["used", "unused"],
        origins: ["github"],
        agents: [],
        creators: [],
      }),
    ).toBe(2);
  });
});
