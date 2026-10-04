/**
 * Unit tests for the agents-list scope partition (iteration 186). Mirrors web's
 * scope semantics (packages/views/agents/components/agents-page.tsx:848-877):
 * a row lands in exactly one scope at a time, `mine` is ownership-scoped to the
 * current user, and an archived agent is excluded from `mine` / `all` even when
 * the viewer owns it.
 */
import { describe, expect, it } from "vitest";
import type { Agent } from "@multica/core/types";
import {
  AGENT_SCOPES,
  DEFAULT_AGENTS_SCOPE,
  agentMatchesScope,
  countAgentsByScope,
  isArchivedAgent,
  type AgentScopeAgent,
  type AgentsScope,
} from "./filter-agents";

const agent = (
  owner: string | null,
  archivedAt: string | null = null,
  status?: string,
): AgentScopeAgent =>
  ({
    owner_id: owner,
    archived_at: archivedAt,
    status: status ?? (archivedAt ? "archived" : "active"),
  }) as AgentScopeAgent;

describe("isArchivedAgent", () => {
  it("trusts archived_at over a non-archived status", () => {
    expect(isArchivedAgent(agent("u1", "2026-01-01T00:00:00Z", "active"))).toBe(
      true,
    );
  });

  it("falls back to the server status when archived_at is absent", () => {
    expect(isArchivedAgent(agent("u1", null, "archived"))).toBe(true);
    expect(isArchivedAgent(agent("u1", null, "active"))).toBe(false);
  });

  it("treats a missing status as active", () => {
    expect(isArchivedAgent({ archived_at: null })).toBe(false);
  });
});

describe("agentMatchesScope", () => {
  const mine = agent("u1");
  const theirs = agent("u2");
  const mineArchived = agent("u1", "2026-01-01T00:00:00Z");

  it("`all` takes every non-archived agent regardless of owner", () => {
    expect(agentMatchesScope(mine, "all", "u1")).toBe(true);
    expect(agentMatchesScope(theirs, "all", "u1")).toBe(true);
    expect(agentMatchesScope(mineArchived, "all", "u1")).toBe(false);
  });

  it("`mine` takes only agents the current user owns", () => {
    expect(agentMatchesScope(mine, "mine", "u1")).toBe(true);
    expect(agentMatchesScope(theirs, "mine", "u1")).toBe(false);
  });

  it("excludes an archived agent from `mine` even when the viewer owns it", () => {
    expect(agentMatchesScope(mineArchived, "mine", "u1")).toBe(false);
  });

  it("`archived` takes exactly the archived rows, whoever owns them", () => {
    expect(agentMatchesScope(mineArchived, "archived", "u1")).toBe(true);
    expect(agentMatchesScope(mine, "archived", "u1")).toBe(false);
  });

  it("matches nothing for `mine` when there is no current user", () => {
    expect(agentMatchesScope(mine, "mine", null)).toBe(false);
    // `all` is still everyone's — a signed-out viewer is not a scope filter.
    expect(agentMatchesScope(mine, "all", null)).toBe(true);
  });

  it("excludes an ownerless agent from `mine`", () => {
    expect(agentMatchesScope(agent(null), "mine", "u1")).toBe(false);
    expect(agentMatchesScope(agent(null), "all", "u1")).toBe(true);
  });

  it("agrees with the per-scope row counts on a mixed set", () => {
    const rows = [mine, theirs, mineArchived, agent("u2", "2026-02-02T00:00:00Z")];
    const counts = countAgentsByScope(rows, "u1");
    const rowsIn = (s: AgentsScope) =>
      rows.filter((a) => agentMatchesScope(a, s, "u1")).length;

    // The pills are NOT three disjoint buckets. `all` means "every non-archived
    // agent", so an agent the viewer owns is counted by BOTH `mine` and `all` —
    // web's `scopeCounts` nests them exactly this way
    // (agents-page.tsx:848-867: `archived++` continues, then `all++`, then a
    // conditional `mine++`). Reading it as a partition would double-count
    // nothing but would misstate the pills' meaning.
    expect(counts.mine).toBe(rowsIn("mine"));
    expect(counts.all).toBe(rowsIn("all"));
    expect(counts.archived).toBe(rowsIn("archived"));

    // `archived` is disjoint from the other two and together they cover the
    // set exactly once — that IS the exhaustive split.
    expect(counts.archived + counts.all).toBe(rows.length);
    // `mine` is a subset of `all`, never of `archived`.
    expect(counts.mine).toBeLessThanOrEqual(counts.all);
  });
});

describe("countAgentsByScope", () => {
  it("counts an owned active agent in both `mine` and `all`, archived only in `archived`", () => {
    const counts = countAgentsByScope(
      [
        agent("u1"),
        agent("u1"),
        agent("u2"),
        agent("u1", "2026-01-01T00:00:00Z"),
        agent("u2", "2026-01-01T00:00:00Z"),
      ],
      "u1",
    );
    expect(counts).toEqual({ mine: 2, all: 3, archived: 2 });
  });

  it("is all zeroes for an empty workspace", () => {
    expect(countAgentsByScope([], "u1")).toEqual({
      mine: 0,
      all: 0,
      archived: 0,
    });
  });

  it("counts no `mine` when there is no current user, but still counts `all`", () => {
    expect(countAgentsByScope([agent("u1"), agent("u2")], null)).toEqual({
      mine: 0,
      all: 2,
      archived: 0,
    });
  });
});

describe("scope vocabulary", () => {
  it("offers web's three scopes in web's order", () => {
    expect(AGENT_SCOPES).toEqual(["mine", "all", "archived"]);
  });

  it("defaults to `mine`, as web's view store does", () => {
    expect(DEFAULT_AGENTS_SCOPE).toBe("mine");
  });
});
