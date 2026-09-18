/**
 * Unit tests for the agents-list row-menu gating (iteration 129, MYS-1060).
 * Mirrors web's `AgentRowActions` derivation
 * (packages/views/agents/components/agent-row-actions.tsx:90-103).
 */
import { describe, expect, it } from "vitest";
import type { Agent } from "@multica/core/types";
import { agentRowActions } from "./agent-row-actions";

const agent = (
  overrides: Partial<Pick<Agent, "archived_at" | "system_key">> = {},
) =>
  ({ archived_at: null, system_key: null, ...overrides }) as Pick<
    Agent,
    "archived_at" | "system_key"
  >;

describe("agentRowActions", () => {
  it("a manageable, idle, active agent offers duplicate + archive", () => {
    expect(agentRowActions(agent(), { canManage: true, hasActiveWork: false })).toEqual([
      "duplicate",
      "archive",
    ]);
  });

  it("adds cancel-tasks only while the agent has active work", () => {
    expect(agentRowActions(agent(), { canManage: true, hasActiveWork: true })).toEqual([
      "cancel-tasks",
      "duplicate",
      "archive",
    ]);
  });

  it("a non-manager still gets duplicate on an active agent", () => {
    expect(agentRowActions(agent(), { canManage: false, hasActiveWork: true })).toEqual([
      "duplicate",
    ]);
  });

  it("an archived agent offers restore to managers and nothing to anyone else", () => {
    const archived = agent({ archived_at: "2026-01-01T00:00:00Z" });
    expect(agentRowActions(archived, { canManage: true, hasActiveWork: false })).toEqual([
      "restore",
    ]);
    // No duplicate (it is retired), no restore (not yours to manage) — the
    // empty list is what hides the kebab.
    expect(agentRowActions(archived, { canManage: false, hasActiveWork: false })).toEqual(
      [],
    );
  });

  it("a built-in agent cannot be archived but can still be duplicated", () => {
    expect(
      agentRowActions(agent({ system_key: "default" }), {
        canManage: true,
        hasActiveWork: false,
      }),
    ).toEqual(["duplicate"]);
  });
});
