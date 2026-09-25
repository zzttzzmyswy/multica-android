/**
 * Mika predicates. Web parity target: `packages/core/onboarding/mika.ts`.
 *
 * The two cases worth pinning are the ones that already burned web: identity
 * by `system_key` rather than display name, and gating the entrypoint on
 * `memberNeedsMikaSetup` rather than `workspaceNeedsMika` — the latter
 * unmounts the card the moment step 1 of three commits.
 */
import { describe, expect, it } from "vitest";
import type { Agent, ChatSession } from "@multica/core/types";
import {
  MIKA_PLACEHOLDER_EMOJI,
  MIKA_SYSTEM_KEY,
  isMikaAgent,
  memberNeedsMikaSetup,
  workspaceNeedsMika,
} from "./mika";

function agent(id: string, systemKey?: string): Pick<Agent, "id" | "system_key"> {
  return { id, system_key: systemKey };
}

function session(
  agentId: string,
  hasOpening: boolean,
): Pick<ChatSession, "agent_id" | "last_message"> {
  return {
    agent_id: agentId,
    last_message: hasOpening
      ? ({ id: "m1", role: "assistant", content: "hi", created_at: "" } as ChatSession["last_message"])
      : null,
  };
}

describe("isMikaAgent", () => {
  it("matches the system key, not the display name", () => {
    // The owner may rename Mika; a name-based check would then report the
    // workspace as having no Mika and offer to create a second one.
    expect(isMikaAgent(agent("a1", MIKA_SYSTEM_KEY))).toBe(true);
    expect(isMikaAgent(agent("a1", "default"))).toBe(false);
    expect(isMikaAgent(agent("a1"))).toBe(false);
  });

  it("does not match a system key that merely contains 'mika'", () => {
    expect(isMikaAgent(agent("a1", "mika-2"))).toBe(false);
    expect(isMikaAgent(agent("a1", "Mika"))).toBe(false);
  });
});

describe("workspaceNeedsMika", () => {
  it("is true when no agent carries the key", () => {
    expect(workspaceNeedsMika([])).toBe(true);
    expect(workspaceNeedsMika([agent("a1", "default")])).toBe(true);
  });

  it("is false once a Mika exists, however many other agents there are", () => {
    expect(workspaceNeedsMika([agent("a1"), agent("a2", MIKA_SYSTEM_KEY)])).toBe(
      false,
    );
  });
});

describe("memberNeedsMikaSetup", () => {
  it("is true when the workspace has no Mika at all", () => {
    expect(memberNeedsMikaSetup([agent("a1")], [])).toBe(true);
  });

  it("is true when Mika exists but this member has no conversation with it", () => {
    // The failure web's comment describes: step 1 committed, step 2 did not.
    expect(memberNeedsMikaSetup([agent("m", MIKA_SYSTEM_KEY)], [])).toBe(true);
  });

  it("is true when the conversation exists but the opening never landed", () => {
    const agents = [agent("m", MIKA_SYSTEM_KEY)];
    expect(memberNeedsMikaSetup(agents, [session("m", false)])).toBe(true);
  });

  it("is false once the member has a Mika conversation with a message", () => {
    const agents = [agent("m", MIKA_SYSTEM_KEY)];
    expect(memberNeedsMikaSetup(agents, [session("m", true)])).toBe(false);
  });

  it("only counts the session belonging to Mika", () => {
    // Another agent's conversation must not satisfy the check.
    const agents = [agent("m", MIKA_SYSTEM_KEY)];
    expect(memberNeedsMikaSetup(agents, [session("other", true)])).toBe(true);
  });

  it("treats an undefined last_message as 'never kicked off'", () => {
    // The session list schema leaves `last_message` optional for older
    // servers; an absent preview is not evidence the opening landed.
    const agents = [agent("m", MIKA_SYSTEM_KEY)];
    expect(
      memberNeedsMikaSetup(agents, [{ agent_id: "m" }]),
    ).toBe(true);
  });

  it("does not depend on the order of the lists", () => {
    const agents = [agent("x", "default"), agent("m", MIKA_SYSTEM_KEY)];
    expect(memberNeedsMikaSetup(agents, [session("m", true)])).toBe(false);
    expect(memberNeedsMikaSetup([...agents].reverse(), [session("m", true)])).toBe(
      false,
    );
  });
});

describe("MIKA_PLACEHOLDER_EMOJI", () => {
  it("is the glyph web's card uses", () => {
    expect(MIKA_PLACEHOLDER_EMOJI).toBe("🦄");
  });
});
