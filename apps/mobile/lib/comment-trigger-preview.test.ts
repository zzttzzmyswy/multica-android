/**
 * Pure-function tests for the mobile comment trigger-preview model — mirrors
 * web semantics from `packages/core/issues/comment-trigger-outcomes.ts`,
 * `packages/views/issues/hooks/use-comment-trigger-preview.ts` and
 * `packages/views/issues/blocked-trigger-copy.ts`.
 */
import { describe, expect, it } from "vitest";
import type { CommentTriggerPreviewAgent } from "@multica/core/types";
import {
  blockedReasonLabel,
  blockedShortReasonLabel,
  blockedTriggerLabel,
  commentTriggerPreviewSignature,
  countWillTrigger,
  emptyTriggerPreview,
  isNoteCommentDraft,
  mentionLabelsByTarget,
  parseMentions,
  pruneSuppressedAgentIds,
  sourceLabel,
  sourceReason,
  type TriggerLabelT,
} from "./comment-trigger-preview";

// A stub `t` that returns the flat key itself, so assertions pin the exact
// i18n key the label helper maps to (same trick mobile uses elsewhere).
const keyT: TriggerLabelT = (id) => id;

const WALT: CommentTriggerPreviewAgent = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Walt",
  source: "issue_assignee",
  reason: "",
};
const KIM: CommentTriggerPreviewAgent = {
  id: "00000000-0000-0000-0000-000000000002",
  name: "Kim",
  source: "mention_agent",
  reason: "",
};

describe("parseMentions", () => {
  it("parses label, type and id from mention markup", () => {
    const mentions = parseMentions(
      `Hi [@Walt](mention://agent/00000000-0000-0000-0000-000000000001)`,
    );
    expect(mentions).toEqual([
      {
        label: "Walt",
        type: "agent",
        id: "00000000-0000-0000-0000-000000000001",
      },
    ]);
  });

  it("accepts a label without the leading @ and captures every mention in order", () => {
    const mentions = parseMentions(
      `[@A](mention://agent/11111111-0000-0000-0000-000000000001) [B](mention://squad/11111111-0000-0000-0000-000000000002)`,
    );
    expect(mentions).toEqual([
      { label: "A", type: "agent", id: "11111111-0000-0000-0000-000000000001" },
      { label: "B", type: "squad", id: "11111111-0000-0000-0000-000000000002" },
    ]);
  });

  it("parses member, issue and @all targets too", () => {
    const mentions = parseMentions(
      `[@Pm](mention://member/22222222-0000-0000-0000-000000000001) [MUL-1](mention://issue/22222222-0000-0000-0000-000000000002) [@all](mention://all/all)`,
    );
    expect(mentions.map((m) => `${m.type}:${m.id}`)).toEqual([
      "member:22222222-0000-0000-0000-000000000001",
      "issue:22222222-0000-0000-0000-000000000002",
      "all:all",
    ]);
  });
});

describe("mentionLabelsByTarget", () => {
  it("maps target_type:target_id to the typed label", () => {
    const labels = mentionLabelsByTarget(
      `[@Walt](mention://agent/00000000-0000-0000-0000-000000000001) [@Go](mention://squad/00000000-0000-0000-0000-000000000009)`,
    );
    expect(labels.get("agent:00000000-0000-0000-0000-000000000001")).toBe("Walt");
    expect(labels.get("squad:00000000-0000-0000-0000-000000000009")).toBe("Go");
  });

  it("last mention of the same target wins", () => {
    const labels = mentionLabelsByTarget(
      `[@First](mention://agent/00000000-0000-0000-0000-000000000001) [@Second](mention://agent/00000000-0000-0000-0000-000000000001)`,
    );
    expect(labels.get("agent:00000000-0000-0000-0000-000000000001")).toBe("Second");
  });
});

describe("blockedTriggerLabel", () => {
  it("returns the label for a matching outcome", () => {
    const outcome = {
      target_type: "agent",
      target_id: "00000000-0000-0000-0000-000000000001",
      status: "blocked",
      reason_code: "target_unavailable",
    };
    const labels = mentionLabelsByTarget(
      `[@Walt](mention://agent/00000000-0000-0000-0000-000000000001)`,
    );
    expect(blockedTriggerLabel(outcome, labels)).toBe("Walt");
  });

  it("is undefined when the mention was edited away", () => {
    const outcome = {
      target_type: "agent",
      target_id: "00000000-0000-0000-0000-000000000001",
      status: "blocked",
      reason_code: "target_unavailable",
    };
    expect(blockedTriggerLabel(outcome, new Map())).toBeUndefined();
  });
});

describe("commentTriggerPreviewSignature", () => {
  it("ignores ordinary text changes", () => {
    expect(commentTriggerPreviewSignature("hello")).toBe(
      commentTriggerPreviewSignature("hello with more ordinary text"),
    );
  });

  it("treats blank content as empty", () => {
    expect(commentTriggerPreviewSignature("")).toBe("empty");
    expect(commentTriggerPreviewSignature("   \n\t ")).toBe("empty");
  });

  it("changes when routing mentions change", () => {
    const agentA = "00000000-0000-0000-0000-000000000001";
    const agentB = "00000000-0000-0000-0000-000000000002";

    expect(
      commentTriggerPreviewSignature(`[@A](mention://agent/${agentA})`),
    ).not.toBe(
      commentTriggerPreviewSignature(
        `[@A](mention://agent/${agentA}) [@B](mention://agent/${agentB})`,
      ),
    );
  });

  it("dedupes repeated mentions of the same target", () => {
    const agentA = "00000000-0000-0000-0000-000000000001";
    expect(
      commentTriggerPreviewSignature(
        `[@A](mention://agent/${agentA}) and again [@A](mention://agent/${agentA})`,
      ),
    ).toBe(commentTriggerPreviewSignature(`[@A](mention://agent/${agentA})`));
  });

  it("tracks @all but ignores issue cross-references", () => {
    const issueID = "00000000-0000-0000-0000-000000000003";

    expect(
      commentTriggerPreviewSignature(`See [MUL-1](mention://issue/${issueID})`),
    ).toBe(commentTriggerPreviewSignature("plain text"));
    expect(commentTriggerPreviewSignature("[@all](mention://all/all)")).not.toBe(
      commentTriggerPreviewSignature("plain text"),
    );
  });

  it("treats note commands as empty", () => {
    const agentA = "00000000-0000-0000-0000-000000000001";

    expect(
      commentTriggerPreviewSignature(`/note [@A](mention://agent/${agentA})`),
    ).toBe("empty");
    expect(
      commentTriggerPreviewSignature(`  /NOTE\n[@A](mention://agent/${agentA})`),
    ).toBe("empty");
    expect(
      commentTriggerPreviewSignature(`/notes [@A](mention://agent/${agentA})`),
    ).not.toBe("empty");
    expect(
      commentTriggerPreviewSignature(`/ note [@A](mention://agent/${agentA})`),
    ).not.toBe("empty");
  });
});

describe("isNoteCommentDraft", () => {
  it("matches the reserved note prefix only as the first token", () => {
    expect(isNoteCommentDraft("/note")).toBe(true);
    expect(isNoteCommentDraft(" \t/Note keep this human-only")).toBe(true);
    expect(isNoteCommentDraft("/notes keep this routable")).toBe(false);
    expect(isNoteCommentDraft("/ note keep this routable")).toBe(false);
    expect(isNoteCommentDraft("please /note later")).toBe(false);
  });
});

describe("sourceLabel", () => {
  it("maps every source to its i18n key", () => {
    expect(sourceLabel("issue_assignee", keyT)).toBe(
      "comment.trigger_source_issue_assignee",
    );
    expect(sourceLabel("mention_agent", keyT)).toBe(
      "comment.trigger_source_mention_agent",
    );
    expect(sourceLabel("mention_squad_leader", keyT)).toBe(
      "comment.trigger_source_mention_squad_leader",
    );
    expect(sourceLabel("future_source", keyT)).toBe(
      "comment.trigger_source_unknown",
    );
  });
});

describe("sourceReason", () => {
  it("omits the reason for assignee and @mention sources", () => {
    expect(sourceReason(WALT, keyT)).toBeNull();
    expect(sourceReason(KIM, keyT)).toBeNull();
  });

  it("explains the squad-leader link", () => {
    expect(
      sourceReason(
        { ...KIM, source: "mention_squad_leader", name: "Go" },
        keyT,
      ),
    ).toBe("comment.trigger_reason_mention_squad_leader");
  });

  it("falls back to the server reason for unknown sources", () => {
    expect(
      sourceReason({ ...KIM, source: "conversation_continuation", reason: "x" }, keyT),
    ).toBe("x");
    expect(sourceReason({ ...KIM, source: "conversation_continuation" }, keyT)).toBe(
      "comment.trigger_reason_unknown",
    );
  });
});

describe("blocked label helpers", () => {
  it("maps each reason code to its short key", () => {
    expect(blockedShortReasonLabel("invocation_not_allowed", keyT)).toBe(
      "comment.trigger_blocked_short_invocation_not_allowed",
    );
    expect(blockedShortReasonLabel("target_unavailable", keyT)).toBe(
      "comment.trigger_blocked_short_target_unavailable",
    );
    expect(blockedShortReasonLabel("runtime_offline", keyT)).toBe(
      "comment.trigger_blocked_short_runtime_offline",
    );
    expect(blockedShortReasonLabel("runtime_unusable", keyT)).toBe(
      "comment.trigger_blocked_short_runtime_unusable",
    );
    expect(blockedShortReasonLabel("agent_runtime_required", keyT)).toBe(
      "comment.trigger_blocked_short_agent_runtime_required",
    );
    expect(blockedShortReasonLabel("some_future_code", keyT)).toBe(
      "comment.trigger_blocked_short_generic",
    );
  });

  it("maps each reason code to its full key", () => {
    expect(blockedReasonLabel("invocation_not_allowed", keyT)).toBe(
      "comment.trigger_blocked_invocation_not_allowed",
    );
    expect(blockedReasonLabel("target_unavailable", keyT)).toBe(
      "comment.trigger_blocked_target_unavailable",
    );
    expect(blockedReasonLabel("runtime_offline", keyT)).toBe(
      "comment.trigger_blocked_runtime_offline",
    );
    expect(blockedReasonLabel("runtime_unusable", keyT)).toBe(
      "comment.trigger_blocked_runtime_unusable",
    );
    expect(blockedReasonLabel("agent_runtime_required", keyT)).toBe(
      "comment.trigger_blocked_agent_runtime_required",
    );
    expect(blockedReasonLabel("some_future_code", keyT)).toBe(
      "comment.trigger_blocked_generic",
    );
  });
});

describe("render-model helpers", () => {
  it("emptyTriggerPreview is empty only when both lists are", () => {
    expect(emptyTriggerPreview([], [])).toBe(true);
    expect(emptyTriggerPreview([WALT], [])).toBe(false);
    expect(emptyTriggerPreview([], [{ target_type: "agent", target_id: "x", status: "blocked", reason_code: "y" }])).toBe(false);
  });

  it("pruneSuppressedAgentIds drops ids no longer in the visible set", () => {
    const prev = new Set([WALT.id, KIM.id, "02222222-0000-0000-0000-000000000022"]);
    const next = pruneSuppressedAgentIds(prev, [WALT, KIM]);
    expect(next).toEqual(new Set([WALT.id, KIM.id]));
  });

  it("countWillTrigger counts only non-suppressed agents", () => {
    expect(countWillTrigger([WALT, KIM], new Set([KIM.id]))).toBe(1);
    expect(countWillTrigger([WALT, KIM], new Set())).toBe(2);
    expect(countWillTrigger([WALT, KIM], new Set([WALT.id, KIM.id]))).toBe(0);
  });
});