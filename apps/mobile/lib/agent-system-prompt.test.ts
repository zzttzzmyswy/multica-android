import { describe, expect, it } from "vitest";
import type { Agent } from "@multica/core/types";
import {
  AGENT_INSTRUCTIONS_COPY,
  agentInstructionsCopy,
  hasSystemPromptLayer,
  systemPromptLayer,
} from "./agent-system-prompt";

/**
 * The two decisions the two-layer instruction field rests on (MYS-2162).
 *
 * A product-defined agent (Mika) carries `system_instructions` — the ~3.5 KB
 * prompt the server renders from its own binary — alongside `instructions`,
 * which holds only this workspace's notes. The edit form used to label the
 * editable half 「指令」 and say nothing about the other half existing, so a
 * reader would take it for the whole prompt.
 *
 * Each assertion below is a thing that can be wrong on its own:
 *   - `hasSystemPromptLayer` true for an ordinary agent → every agent grows a
 *     read-only card over text the server never sent.
 *   - false for a system agent → the defect, unchanged.
 *   - the copy not switching with the layer → the card appears but the field
 *     below still claims to be the whole prompt, which is the mislabelling.
 */

const agent = (overrides: Partial<Agent> = {}): Agent =>
  ({ id: "a1", instructions: "", ...overrides }) as Agent;

describe("systemPromptLayer", () => {
  it("returns the trimmed product half", () => {
    expect(systemPromptLayer(agent({ system_instructions: "  You are Mika.  " }))).toBe(
      "You are Mika.",
    );
  });

  it("is empty for an ordinary agent — the field is simply absent", () => {
    expect(systemPromptLayer(agent({ instructions: "our notes" }))).toBe("");
  });

  it("tolerates a null / undefined agent", () => {
    expect(systemPromptLayer(null)).toBe("");
    expect(systemPromptLayer(undefined)).toBe("");
  });
});

describe("hasSystemPromptLayer", () => {
  it("is true exactly when the product half has content", () => {
    expect(hasSystemPromptLayer(agent({ system_instructions: "You are Mika." }))).toBe(true);
  });

  it("is false for an ordinary agent", () => {
    // The common path. Nothing in this iteration may change how it renders.
    expect(hasSystemPromptLayer(agent({ instructions: "our notes", system_key: undefined }))).toBe(
      false,
    );
  });

  it("is false for a whitespace-only product half", () => {
    // The server omits the field for ordinary agents, but an empty-or-blank
    // value must not render a card headed "Maintained by Multica" over nothing.
    expect(hasSystemPromptLayer(agent({ system_instructions: "   \n  " }))).toBe(false);
  });

  it("does not key off system_key — the payload decides, not the label", () => {
    // A system_key with no instructions (an older backend, a partial response)
    // must not fabricate a layer, and instructions without the key must still
    // show: the two fields are the server's decision to make together.
    expect(hasSystemPromptLayer(agent({ system_key: "mika" }))).toBe(false);
    expect(hasSystemPromptLayer(agent({ system_instructions: "P" }))).toBe(true);
  });

  it("is false for a null / undefined agent", () => {
    expect(hasSystemPromptLayer(null)).toBe(false);
    expect(hasSystemPromptLayer(undefined)).toBe(false);
  });
});

describe("agentInstructionsCopy", () => {
  it("keeps today's wording when there is no system half", () => {
    const copy = agentInstructionsCopy(false);
    expect(copy).toEqual(AGENT_INSTRUCTIONS_COPY.plain);
    expect(copy.labelKey).toBe("agents.new.instructionsLabel");
    expect(copy.placeholderKey).toBe("agents.new.instructionsPlaceholder");
    expect(copy.introKey).toBeNull();
  });

  it("switches to the workspace-notes wording when there is one", () => {
    const copy = agentInstructionsCopy(true);
    expect(copy).toEqual(AGENT_INSTRUCTIONS_COPY.workspaceNotes);
    expect(copy.labelKey).toBe("agents.instructions.workspaceLabel");
    expect(copy.placeholderKey).toBe("agents.instructions.workspacePlaceholder");
    expect(copy.introKey).toBe("agents.instructions.workspaceIntro");
  });

  it("never returns the plain field for a layered agent", () => {
    // The defect in one line: a system agent whose editable field is still
    // called 「指令」. Asserted by key identity rather than by a copy of the
    // strings so the check cannot drift when the wording does.
    for (const key of [
      agentInstructionsCopy(true).labelKey,
      agentInstructionsCopy(true).placeholderKey,
    ]) {
      expect(key).not.toBe(agentInstructionsCopy(false).labelKey);
      expect(key).not.toBe(agentInstructionsCopy(false).placeholderKey);
    }
  });

  it("carries an intro only on the layered branch", () => {
    // The intro is the sentence that states the layering ("applies on top of
    // what Multica maintains, never overwritten"). Without it the rename alone
    // still leaves the reader guessing what their text does.
    expect(agentInstructionsCopy(false).introKey).toBeNull();
    expect(agentInstructionsCopy(true).introKey).toBeTruthy();
  });
});
