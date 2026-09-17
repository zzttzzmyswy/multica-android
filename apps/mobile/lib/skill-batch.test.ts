/**
 * Batch skill-list helpers (MYS-1156, web parity with
 * `packages/views/skills/components/skill-list-actions.tsx`).
 *
 * The server has no batch endpoint for skills: web loops the single-skill
 * calls itself and surfaces the first failure as a toast. The mobile list
 * mirrors that call shape but has to be honest about *partial* failure —
 * a 5-of-8 delete that half-succeeded must not read as "deleted 8" — so the
 * aggregation here is the part worth pinning.
 */
import { describe, expect, it } from "vitest";
import type { Agent } from "@multica/core/types";
import {
  batchOutcomeMessage,
  missingSkillIds,
  planSkillAttach,
  summarizeBatch,
  toggleId,
  toggleSelectAllVisible,
} from "./skill-batch";

function agent(id: string, skillIds: string[], ownerId: string | null = null): Agent {
  return {
    id,
    name: `agent ${id}`,
    owner_id: ownerId,
    archived_at: null,
    skills: skillIds.map((sid) => ({ id: sid })),
  } as unknown as Agent;
}

describe("toggleId", () => {
  it("adds an unselected id and removes a selected one", () => {
    expect([...toggleId(new Set(["a"]), "b")]).toEqual(["a", "b"]);
    expect([...toggleId(new Set(["a", "b"]), "a")]).toEqual(["b"]);
  });

  it("never mutates the input set", () => {
    const input = new Set(["a"]);
    toggleId(input, "b");
    expect([...input]).toEqual(["a"]);
  });
});

describe("toggleSelectAllVisible", () => {
  it("selects every visible row when the selection is incomplete", () => {
    expect([...toggleSelectAllVisible(["a", "b"], new Set(["a"]))]).toEqual([
      "a",
      "b",
    ]);
  });

  it("clears when every visible row is already selected (web's toggle)", () => {
    expect([...toggleSelectAllVisible(["a", "b"], new Set(["a", "b"]))]).toEqual(
      [],
    );
  });

  it("drops ids that scrolled out of the visible set", () => {
    // "c" was selected, then filtered out: the all-or-none rule must not
    // carry a row the user can no longer see into the next batch.
    expect([...toggleSelectAllVisible(["a", "b"], new Set(["a", "b", "c"]))]).toEqual(
      [],
    );
  });

  it("stays empty for an empty list", () => {
    expect([...toggleSelectAllVisible([], new Set(["a"]))]).toEqual([]);
  });
});

describe("missingSkillIds", () => {
  it("returns the skills the agent does not have yet", () => {
    expect(missingSkillIds(agent("a", ["s1"]), ["s1", "s2"])).toEqual(["s2"]);
  });

  it("returns nothing when the agent already has every skill", () => {
    expect(missingSkillIds(agent("a", ["s1", "s2"]), ["s1", "s2"])).toEqual([]);
  });

  it("tolerates an agent payload with no skills array", () => {
    const bare = { id: "a", name: "a", owner_id: null, archived_at: null } as Agent;
    expect(missingSkillIds(bare, ["s1"])).toEqual(["s1"]);
  });
});

describe("planSkillAttach", () => {
  it("skips targets that already have every selected skill", () => {
    const agents = [agent("a", ["s1", "s2"]), agent("b", [])];
    expect(planSkillAttach(agents, ["a", "b"], ["s1", "s2"])).toEqual([
      { agentId: "b", skillIds: ["s1", "s2"] },
    ]);
  });

  it("only sends the missing subset per target (the endpoint is additive)", () => {
    const agents = [agent("a", ["s1"])];
    expect(planSkillAttach(agents, ["a"], ["s1", "s2"])).toEqual([
      { agentId: "a", skillIds: ["s2"] },
    ]);
  });

  it("ignores target ids that are not in the loaded agent list", () => {
    expect(planSkillAttach([agent("a", [])], ["a", "ghost"], ["s1"])).toEqual([
      { agentId: "a", skillIds: ["s1"] },
    ]);
  });

  it("plans nothing when no skill is selected", () => {
    expect(planSkillAttach([agent("a", [])], ["a"], [])).toEqual([]);
  });

  it("keeps the caller's target order so the toast count matches the sheet", () => {
    const agents = [agent("a", []), agent("b", []), agent("c", [])];
    expect(planSkillAttach(agents, ["c", "a"], ["s1"]).map((p) => p.agentId)).toEqual(
      ["c", "a"],
    );
  });
});

/** `allSettled` always carries a `value` on the fulfilled branch; the
 * aggregation never reads it, so the tests only need the discriminant. */
const FULFILLED = { status: "fulfilled", value: undefined } as const;

describe("summarizeBatch", () => {
  it("reports every id as succeeded when nothing threw", () => {
    const outcome = summarizeBatch(["a", "b"], [
      FULFILLED,
      FULFILLED,
    ]);
    expect(outcome).toEqual({ succeeded: ["a", "b"], failures: [] });
  });

  it("pairs each rejection with its own id and message", () => {
    const outcome = summarizeBatch(["a", "b", "c"], [
      FULFILLED,
      { status: "rejected", reason: new Error("boom") },
      { status: "rejected", reason: "plain string" },
    ]);
    expect(outcome.succeeded).toEqual(["a"]);
    expect(outcome.failures).toEqual([
      { id: "b", message: "boom" },
      { id: "c", message: "plain string" },
    ]);
  });

  it("falls back to an empty message for a rejection with nothing to show", () => {
    const outcome = summarizeBatch(["a"], [{ status: "rejected", reason: {} }]);
    expect(outcome.failures).toEqual([{ id: "a", message: "" }]);
  });

  it("stops pairing once the ids run out", () => {
    const outcome = summarizeBatch(["a"], [
      FULFILLED,
      { status: "rejected", reason: new Error("extra") },
    ]);
    expect(outcome.failures).toEqual([]);
  });
});

describe("batchOutcomeMessage", () => {
  const messages = {
    success: (done: number) => `deleted ${done}`,
    failure: (done: number, failed: number, first: string) =>
      `${done} deleted, ${failed} failed: ${first}`,
  };

  it("uses the success wording when nothing failed", () => {
    expect(
      batchOutcomeMessage({ succeeded: ["a"], failures: [] }, messages),
    ).toBe("deleted 1");
  });

  it("uses the partial wording when only some failed", () => {
    expect(
      batchOutcomeMessage(
        { succeeded: ["a"], failures: [{ id: "b", message: "boom" }] },
        messages,
      ),
    ).toBe("1 deleted, 1 failed: boom");
  });

  it("reports a total failure with the first error's message", () => {
    expect(
      batchOutcomeMessage(
        {
          succeeded: [],
          failures: [
            { id: "a", message: "first" },
            { id: "b", message: "second" },
          ],
        },
        messages,
      ),
    ).toBe("0 deleted, 2 failed: first");
  });
});
