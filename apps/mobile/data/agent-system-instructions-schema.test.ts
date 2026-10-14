import { describe, expect, it } from "vitest";
import { AgentListSchema, AgentSchema } from "./schemas";
import { hasSystemPromptLayer, systemPromptLayer } from "@/lib/agent-system-prompt";

/**
 * `system_instructions` on the wire (MYS-2162).
 *
 * The list endpoint fills this per row for every visible agent
 * (`server/internal/handler/agent.go:187`, `:926` — `agentToResponse` sets it
 * unconditionally), so the phone has always received it; until this iteration
 * nothing read it. These assertions pin the two things the reading code depends
 * on:
 *
 *   1. the field survives BOTH parse paths the pickers and the edit form use —
 *      the workspace list (`AgentListSchema`) and a single agent (`AgentSchema`);
 *   2. an ordinary agent's absence stays an absence. `.optional()` — not
 *      `.default("")` — is what keeps "the server has no such field" distinct
 *      from "the server sent an empty one", and `hasSystemPromptLayer` reads
 *      the difference. A `.default("")` here would type-check and behave
 *      identically for a Mika, which is why this is asserted rather than
 *      assumed.
 */
describe("AgentSchema system_instructions", () => {
  const PRODUCT_HALF = "You are Mika, the default agent and Chief of Staff…";

  it("carries the product half through the single-agent parse", () => {
    const parsed = AgentSchema.parse({
      id: "agent-1",
      instructions: "our workspace notes",
      system_key: "mika",
      system_instructions: PRODUCT_HALF,
    });

    expect(parsed.system_instructions).toBe(PRODUCT_HALF);
    // Both halves in one row: `instructions` stays the workspace's own notes
    // and the two must not be conflated by the parser.
    expect(parsed.instructions).toBe("our workspace notes");
    expect(systemPromptLayer(parsed)).toBe(PRODUCT_HALF);
    expect(hasSystemPromptLayer(parsed)).toBe(true);
  });

  it("carries it through the workspace list parse", () => {
    // The detail screen and the edit form both resolve their agent out of this
    // list, so a parser that dropped the field on the list path would leave the
    // feature invisible however correct the UI is.
    const parsed = AgentListSchema.parse([
      { id: "agent-1", name: "Mika", system_key: "mika", system_instructions: PRODUCT_HALF },
      { id: "agent-2", name: "Ordinary", instructions: "notes" },
    ]);

    expect(parsed[0].system_instructions).toBe(PRODUCT_HALF);
    expect(hasSystemPromptLayer(parsed[0])).toBe(true);
    expect(parsed[1].system_instructions).toBeUndefined();
    expect(hasSystemPromptLayer(parsed[1])).toBe(false);
  });

  it("stays absent — not empty — for an ordinary agent", () => {
    const parsed = AgentSchema.parse({ id: "agent-1", instructions: "notes" });
    expect(parsed.system_instructions).toBeUndefined();
    expect(parsed.system_key).toBeUndefined();
  });

  it("keeps an explicit empty string distinguishable from absence", () => {
    // A backend that sends "" is saying "no product half for this one"; the
    // predicate must reject it either way, and the parser must not rewrite it
    // into undefined (a `.default()` would, silently collapsing the two).
    const parsed = AgentSchema.parse({ id: "agent-1", system_instructions: "" });
    expect(parsed.system_instructions).toBe("");
    expect(hasSystemPromptLayer(parsed)).toBe(false);
  });

  it("degrades a drifted value instead of throwing in the render", () => {
    // `.loose()` passes anything through, so without the declared field a
    // `null` (or a number) reached `systemPromptLayer`'s `.trim()` and threw
    // inside the agent screen — one unread field taking down the page. Caught
    // at the boundary it reads as "no system layer", which is the honest
    // reading of a value this screen cannot use.
    for (const drifted of [null, 42, { text: "P" }] as unknown[]) {
      const parsed = AgentSchema.parse({ id: "agent-1", system_instructions: drifted });
      expect(parsed.system_instructions).toBeUndefined();
      expect(hasSystemPromptLayer(parsed)).toBe(false);
      // And the predicate must survive being handed the raw value too — the
      // guard is on the parse, but a caller reading the type directly should
      // not be the thing that crashes.
      expect(() => systemPromptLayer({ system_instructions: drifted as string })).not.toThrow();
    }
  });
});
