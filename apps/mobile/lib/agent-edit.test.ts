import { describe, expect, it } from "vitest";
import type { AgentDraft } from "@multica/core/agents";
import { agentEditGate } from "./agent-edit";

const draft = (overrides: Partial<AgentDraft> = {}): AgentDraft => ({
  name: "Fast Codex",
  description: "Ships quickly",
  instructions: "Be quick",
  avatarUrl: null,
  runtimeId: "runtime-1",
  model: "gpt-5.6-sol",
  thinkingLevel: "high",
  serviceTier: "priority",
  skillIds: new Set(),
  permissionScope: "private",
  memberIds: new Set(),
  teamIds: new Set(),
  ...overrides,
});

describe("agentEditGate", () => {
  it("accepts a ready edit draft", () => {
    expect(agentEditGate(draft())).toEqual({
      nameMissing: false,
      runtimeMissing: false,
      accessInvalid: false,
      descriptionOverLimit: false,
    });
  });

  it("flags a missing name and members-scope with no grants", () => {
    const gate = agentEditGate(
      draft({ name: "  ", permissionScope: "members", memberIds: new Set() }),
    );
    expect(gate.nameMissing).toBe(true);
    expect(gate.accessInvalid).toBe(true);
  });

  it("treats a bound-but-offline runtime as valid — edit must not force a rebind", () => {
    // The agent's own runtime simply has no entry in the workspace runtimes
    // the create gate feeds on; the edit gate never consults that list. An
    // empty selection is still a gate failure.
    expect(agentEditGate(draft({ runtimeId: "runtime-1" })).runtimeMissing).toBe(
      false,
    );
    expect(agentEditGate(draft({ runtimeId: "" })).runtimeMissing).toBe(true);
  });

  it("enforces the 255-rune description cap", () => {
    expect(agentEditGate(draft({ description: "汉".repeat(256) })).descriptionOverLimit).toBe(
      true,
    );
  });
});