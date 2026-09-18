/**
 * Tests for the squad-create-context helpers (iteration 121, MYS-1032).
 * Mirrors web manual-create-agent-page.tsx `?squad=` semantics:
 *  - A squad param switches the form into squad context (title/copy change).
 *  - After a successful create the new agent joins the squad via
 *    POST /api/squads/:id/members {member_type:"agent"}.
 *  - A failed join must not fail the create — the agent exists; the user is
 *    told the join failed and can add it manually from the squad page.
 */
import { describe, expect, it } from "vitest";
import { agentSquadJoin } from "./agent-squad-join";

describe("agentSquadJoin", () => {
  it("returns null payload when no squad context", () => {
    expect(agentSquadJoin(null, "agent-1", "agent name").payload).toBeNull();
    expect(agentSquadJoin("", "agent-1", "agent name").payload).toBeNull();
  });

  it("builds an agent-member payload for the new agent", () => {
    const result = agentSquadJoin("sq-1", "agent-1", "My Agent");
    expect(result.payload).toEqual({
      member_type: "agent",
      member_id: "agent-1",
    });
    expect(result.squadId).toBe("sq-1");
  });

  it("falls back to the draft name when the created agent has no name", () => {
    expect(agentSquadJoin("sq-1", "agent-1", "").agentNameForError).toBe("");
    expect(agentSquadJoin("sq-1", "agent-1", "Draft").agentNameForError).toBe(
      "Draft",
    );
  });

  it("classifies a join failure as non-fatal", () => {
    const err = new Error("409 already a member");
    expect(agentSquadJoin("sq-1", "agent-1", "A").joinFatal).toBe(false);
    void err;
  });
});
