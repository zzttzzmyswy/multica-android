// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  canCustomizeConversationStarters,
  conversationStartersWithinLimits,
  normalizeConversationStarters,
  selectConversationStarters,
} from "./conversation-starters";
import {
  AGENT_CONVERSATION_STARTERS_MAX,
  AGENT_CONVERSATION_STARTER_LABEL_MAX_LENGTH,
  AGENT_CONVERSATION_STARTER_MAX_LENGTH,
} from "./constants";

const fallback = [
  { label: "Fallback one", prompt: "Fallback prompt one." },
  { label: "Fallback two", prompt: "Fallback prompt two." },
];

describe("selectConversationStarters", () => {
  it("falls back when the agent configured nothing", () => {
    expect(selectConversationStarters([], fallback)).toEqual({
      starters: fallback,
      isFallback: true,
    });
    expect(selectConversationStarters(undefined, fallback).isFallback).toBe(true);
    expect(selectConversationStarters(null, fallback).isFallback).toBe(true);
  });

  it("keeps only rows where both halves carry text", () => {
    const result = selectConversationStarters(
      [
        { label: "Review the release PR", prompt: "Review it and list risks." },
        { label: "  ", prompt: "Orphan prompt." },
        { label: "Orphan label", prompt: "   " },
      ],
      fallback,
    );

    expect(result).toEqual({
      starters: [
        { label: "Review the release PR", prompt: "Review it and list risks." },
      ],
      isFallback: false,
    });
  });

  it("falls back when every configured row is half-filled", () => {
    expect(
      selectConversationStarters([{ label: "Orphan", prompt: "" }], fallback),
    ).toEqual({ starters: fallback, isFallback: true });
  });

  it("returns the configured rows by reference, not a copy to be mutated", () => {
    // The reader renders these directly; a caller that mutated the result
    // would be editing the agent object it came from.
    const configured = [{ label: "Keep me", prompt: "As I am." }];
    expect(selectConversationStarters(configured, fallback).starters[0]).toBe(
      configured[0],
    );
  });
});

describe("canCustomizeConversationStarters", () => {
  const live = { archived_at: null };
  const allowed = { conversationStartersSupported: true, canEditAgent: true };

  it("offers the editor to someone who may edit a live agent", () => {
    expect(canCustomizeConversationStarters(live, allowed)).toBe(true);
  });

  it("stays silent for a reader", () => {
    expect(
      canCustomizeConversationStarters(live, { ...allowed, canEditAgent: false }),
    ).toBe(false);
  });

  it("stays silent on a backend that drops conversation starters", () => {
    expect(
      canCustomizeConversationStarters(live, {
        ...allowed,
        conversationStartersSupported: false,
      }),
    ).toBe(false);
  });

  it("stays silent for an archived agent, editor or not", () => {
    expect(
      canCustomizeConversationStarters(
        { archived_at: "2026-08-01T00:00:00Z" },
        allowed,
      ),
    ).toBe(false);
  });

  it("stays silent while no agent is resolved", () => {
    expect(canCustomizeConversationStarters(null, allowed)).toBe(false);
  });
});

describe("conversationStartersWithinLimits", () => {
  it("accepts an empty list and complete rows", () => {
    expect(conversationStartersWithinLimits([])).toBe(true);
    expect(
      conversationStartersWithinLimits([
        { label: "One", prompt: "Do the thing." },
        { label: "Two", prompt: "Do the other thing." },
      ]),
    ).toBe(true);
  });

  it("rejects a half-filled row so save can be blocked rather than silently dropping it", () => {
    expect(
      conversationStartersWithinLimits([{ label: "Draft a plan", prompt: "" }]),
    ).toBe(false);
    expect(
      conversationStartersWithinLimits([{ label: "  ", prompt: "Orphan." }]),
    ).toBe(false);
  });

  it("rejects more rows than the server accepts", () => {
    const rows = Array.from(
      { length: AGENT_CONVERSATION_STARTERS_MAX + 1 },
      (_, i) => ({ label: `Row ${i}`, prompt: `Prompt ${i}.` }),
    );
    expect(conversationStartersWithinLimits(rows)).toBe(false);
  });

  it("counts characters, not UTF-16 units, at both caps", () => {
    // The server measures runes (`utf8.RuneCountInString`), so a label of
    // astral-plane characters must not read as over the limit here.
    const astral = "🌍".repeat(AGENT_CONVERSATION_STARTER_LABEL_MAX_LENGTH);
    expect(
      conversationStartersWithinLimits([{ label: astral, prompt: "ok" }]),
    ).toBe(true);
    expect(
      conversationStartersWithinLimits([
        { label: `${astral}🌍`, prompt: "ok" },
      ]),
    ).toBe(false);

    const longPrompt = "字".repeat(AGENT_CONVERSATION_STARTER_MAX_LENGTH);
    expect(
      conversationStartersWithinLimits([{ label: "ok", prompt: longPrompt }]),
    ).toBe(true);
    expect(
      conversationStartersWithinLimits([
        { label: "ok", prompt: `${longPrompt}字` },
      ]),
    ).toBe(false);
  });
});

describe("normalizeConversationStarters", () => {
  it("trims both halves and drops incomplete rows", () => {
    expect(
      normalizeConversationStarters([
        { label: "  Plan a release  ", prompt: "  Plan the next release.  " },
        { label: "Half", prompt: "   " },
      ]),
    ).toEqual([{ label: "Plan a release", prompt: "Plan the next release." }]);
  });

  it("caps the list and each field at the server's bounds", () => {
    const rows = Array.from(
      { length: AGENT_CONVERSATION_STARTERS_MAX + 2 },
      (_, i) => ({ label: `Row ${i}`, prompt: `Prompt ${i}.` }),
    );
    expect(normalizeConversationStarters(rows)).toHaveLength(
      AGENT_CONVERSATION_STARTERS_MAX,
    );

    const [capped] = normalizeConversationStarters([
      {
        label: "L".repeat(AGENT_CONVERSATION_STARTER_LABEL_MAX_LENGTH + 50),
        prompt: "P".repeat(AGENT_CONVERSATION_STARTER_MAX_LENGTH + 50),
      },
    ]);
    expect([...capped.label]).toHaveLength(
      AGENT_CONVERSATION_STARTER_LABEL_MAX_LENGTH,
    );
    expect([...capped.prompt]).toHaveLength(AGENT_CONVERSATION_STARTER_MAX_LENGTH);
  });

  it("keeps an all-incomplete list empty rather than inventing rows", () => {
    expect(
      normalizeConversationStarters([{ label: "", prompt: "" }]),
    ).toEqual([]);
  });
});
