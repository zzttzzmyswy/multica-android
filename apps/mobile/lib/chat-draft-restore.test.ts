/**
 * Guard for the cancelled-prompt restore decisions (#5219).
 *
 * These are the rules that stand between a cancelled prompt and losing it, so
 * each one is asserted directly AND falsified: a guard that cannot be made to
 * fail is not a guard (see scripts/falsify-iter242-*.py).
 */
import { describe, expect, it } from "vitest";
import type { Attachment } from "@multica/core/types";
import {
  CHAT_DRAFT_RESTORE_CAPABILITY,
  decideRestoreApplication,
  dequeuePendingRestore,
  enqueuePendingRestore,
  forgetRestoreApplied,
  markRestoreApplied,
  pickPendingRestore,
  pickRestoresToReconcile,
  planCancelFinalized,
  planCancelRestore,
  restoredAttachmentToComposerItem,
  type PendingSendRestore,
  type RestoreDraftRequest,
} from "./chat-draft-restore";

const attachment = {
  id: "att-1",
  url: "/api/attachments/att-1/download",
  download_url: "/api/attachments/att-1/download",
  filename: "diagram.png",
  content_type: "image/png",
} as unknown as Attachment;

function request(over: Partial<RestoreDraftRequest> = {}): RestoreDraftRequest {
  return { id: "msg-1", content: "hello", sessionId: "session-a", ...over };
}

// The capability token is the server's gate: it switches the cancel from the
// legacy branch (prompt deleted immediately, content only in the response) to
// the deferred one (prompt parked in a durable row). Sending the wrong string
// silently puts the client back on the branch that drops input if the response
// is not read, and the server compares it exactly.
describe("capability token", () => {
  it("matches the literal the server gates deferred cancellation on", () => {
    expect(CHAT_DRAFT_RESTORE_CAPABILITY).toBe("chat-draft-restore-v1");
  });
});

describe("decideRestoreApplication", () => {
  const base = {
    request: request(),
    draftKey: "session-a",
    appliedRestoreIds: [] as string[],
  };

  it("applies into an empty composer on the addressed session", () => {
    expect(decideRestoreApplication(base)).toBe("apply");
  });

  it("does nothing without a request", () => {
    expect(decideRestoreApplication({ ...base, request: null })).toBe("idle");
  });

  it("never re-offers a durable restore already in the ledger", () => {
    // Regression guard for the lost-consume hole: the row may still be on the
    // server, so only the ledger can stop it being offered a second time.
    expect(
      decideRestoreApplication({
        ...base,
        request: request({ serverRestoreId: "msg-1" }),
        appliedRestoreIds: ["msg-1"],
      }),
    ).toBe("idle");
  });

  it("waits — rather than applying — when the request is for another session", () => {
    // A failed fire-and-forget send must not dump its text into whatever the
    // user happens to be looking at now.
    expect(
      decideRestoreApplication({ ...base, draftKey: "session-b" }),
    ).toBe("wait-session");
  });

  it("hands the offer over regardless of draft state — the composer decides", () => {
    // The busy guard deliberately does NOT live here. Routing it through the
    // owner means owner state → hook deps → verdict → prop → composer effect →
    // owner state, which is an infinite render loop (observed on device as
    // "Maximum update depth exceeded" in ChatTab). The composer declines to
    // apply instead, leaving the request pending, which is the same WAIT.
    expect(decideRestoreApplication(base)).toBe("apply");
  });

  it("applies a session-less restore into the current composer", () => {
    expect(
      decideRestoreApplication({ ...base, request: request({ sessionId: undefined }) }),
    ).toBe("apply");
  });
});

const row = (id: string, sessionId: string) => ({
  id,
  chat_session_id: sessionId,
  content: `text-${id}`,
});

describe("pickPendingRestore", () => {
  it("takes only the addressed session's row", () => {
    const picked = pickPendingRestore(
      [row("r1", "session-b"), row("r2", "session-a")],
      "session-a",
      [],
    );
    expect(picked?.id).toBe("r2");
  });

  it("skips rows already applied here", () => {
    expect(
      pickPendingRestore([row("r1", "session-a")], "session-a", ["r1"]),
    ).toBeNull();
  });

  it("returns null when the server reported nothing", () => {
    expect(pickPendingRestore(undefined, "session-a", [])).toBeNull();
  });
});

describe("pickRestoresToReconcile", () => {
  it("re-consumes exactly the rows that are applied locally but still on the server", () => {
    expect(
      pickRestoresToReconcile(
        [row("r1", "session-a"), row("r2", "session-a"), row("r3", "session-b")],
        "session-a",
        ["r2"],
      ).map((r) => r.id),
    ).toEqual(["r2"]);
  });

  it("has nothing to reconcile when the ledger is empty", () => {
    expect(pickRestoresToReconcile([row("r1", "session-a")], "session-a", [])).toEqual([]);
  });
});

describe("applied ledger", () => {
  it("appends a new id", () => {
    expect(markRestoreApplied([], "r1")).toEqual(["r1"]);
  });

  it("is idempotent", () => {
    const once = markRestoreApplied([], "r1");
    expect(markRestoreApplied(once, "r1")).toBe(once);
  });

  it("forgets only on a confirmed consume", () => {
    expect(forgetRestoreApplied(["r1", "r2"], "r1")).toEqual(["r2"]);
  });

  it("ignores a forget for an id it never held", () => {
    const held = ["r1"];
    expect(forgetRestoreApplied(held, "nope")).toBe(held);
  });

  it("does not cap the ledger — an evicted entry would re-arm a sent prompt", () => {
    let ledger: string[] = [];
    for (let i = 0; i < 60; i++) ledger = markRestoreApplied(ledger, `r-${i}`);
    expect(ledger).toHaveLength(60);
  });
});

describe("server-less restore queue", () => {
  const restore = (id: string, sessionId = "session-a"): PendingSendRestore => ({
    id,
    content: `text-${id}`,
    sessionId,
  });

  it("queues per session, oldest first", () => {
    const q = enqueuePendingRestore(
      enqueuePendingRestore({}, restore("r1")),
      restore("r2"),
    );
    expect(q["session-a"].map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("keeps sessions apart", () => {
    const q = enqueuePendingRestore(
      enqueuePendingRestore({}, restore("r1", "session-a")),
      restore("r2", "session-b"),
    );
    expect(Object.keys(q).sort()).toEqual(["session-a", "session-b"]);
  });

  it("de-dupes the same id", () => {
    const once = enqueuePendingRestore({}, restore("r1"));
    expect(enqueuePendingRestore(once, restore("r1"))).toBe(once);
  });

  it("drops the session key once its last entry is taken", () => {
    const q = enqueuePendingRestore({}, restore("r1"));
    expect(dequeuePendingRestore(q, "session-a", "r1")).toEqual({});
  });

  it("leaves later entries queued", () => {
    const q = enqueuePendingRestore(
      enqueuePendingRestore({}, restore("r1")),
      restore("r2"),
    );
    expect(
      dequeuePendingRestore(q, "session-a", "r1")["session-a"].map((r) => r.id),
    ).toEqual(["r2"]);
  });

  it("ignores a dequeue for something it does not hold", () => {
    const q = enqueuePendingRestore({}, restore("r1"));
    expect(dequeuePendingRestore(q, "session-a", "other")).toBe(q);
  });
});

describe("planCancelRestore", () => {
  const cancelled = {
    chat_session_id: "session-a",
    message_id: "msg-1",
    content: "the prompt",
    restore_to_input: true,
    attachments: [attachment],
  };

  it("evicts the deleted bubble and restores the text", () => {
    const plan = planCancelRestore(cancelled, {
      sessionId: "session-a",
      restoreDraftToInput: true,
    });
    expect(plan.removeMessageId).toBe("msg-1");
    expect(plan.restore).toEqual({
      id: "msg-1",
      content: "the prompt",
      attachments: [attachment],
      sessionId: "session-a",
    });
  });

  it("does nothing for a response with no cancellation payload", () => {
    expect(
      planCancelRestore(undefined, { sessionId: "session-a", restoreDraftToInput: true }),
    ).toEqual({ removeMessageId: null, restore: null });
  });

  it("still evicts the bubble when the server says not to restore", () => {
    // `restore_to_input: false` means the deleted row was a kickoff, not the
    // member's prompt — the bubble is gone either way, the text is not restored.
    const plan = planCancelRestore(
      { ...cancelled, restore_to_input: false },
      { sessionId: "session-a", restoreDraftToInput: true },
    );
    expect(plan.removeMessageId).toBe("msg-1");
    expect(plan.restore).toBeNull();
  });

  it("does not restore a queued remove — that was an explicit discard", () => {
    const plan = planCancelRestore(cancelled, {
      sessionId: "session-a",
      queuedAction: "remove",
      restoreDraftToInput: true,
    });
    expect(plan.restore).toBeNull();
  });

  it("does not restore when the caller does not want it", () => {
    const plan = planCancelRestore(cancelled, {
      sessionId: "session-a",
      restoreDraftToInput: false,
    });
    expect(plan.restore).toBeNull();
  });

  it("does not restore across sessions", () => {
    // The restore belongs to the session that was cancelled, which may not be
    // the one on screen.
    const plan = planCancelRestore(cancelled, {
      sessionId: "session-other",
      restoreDraftToInput: true,
    });
    expect(plan.restore).toBeNull();
    expect(plan.removeMessageId).toBe("msg-1");
  });
});

describe("planCancelFinalized", () => {
  const base = {
    chatSessionId: "session-a",
    taskId: "task-1",
    initiatorUserId: "user-1",
    currentUserId: "user-1",
  };

  it("evicts the deleted message and refetches the durable restores for the initiator", () => {
    expect(
      planCancelFinalized({
        ...base,
        outcome: "restored",
        messageId: "msg-1",
      }),
    ).toEqual({
      removeMessageId: "msg-1",
      cancelTaskId: "task-1",
      refetchDraftRestores: true,
    });
  });

  it("fails closed on a missing initiator — never refetch for someone else", () => {
    expect(
      planCancelFinalized({
        ...base,
        outcome: "restored",
        initiatorUserId: undefined,
      }).refetchDraftRestores,
    ).toBe(false);
  });

  it("does not refetch for a different user", () => {
    expect(
      planCancelFinalized({
        ...base,
        outcome: "restored",
        currentUserId: "user-2",
      }).refetchDraftRestores,
    ).toBe(false);
  });

  it("still evicts the message for a non-initiator viewing the session", () => {
    // The bubble is gone for everyone; only the refetch is initiator-scoped.
    expect(
      planCancelFinalized({
        ...base,
        outcome: "restored",
        messageId: "msg-1",
        currentUserId: "user-2",
      }).removeMessageId,
    ).toBe("msg-1");
  });

  it("treats 'stopped' as a persisted assistant row, not a restore", () => {
    expect(
      planCancelFinalized({ ...base, outcome: "stopped" }),
    ).toEqual({
      removeMessageId: null,
      cancelTaskId: null,
      refetchDraftRestores: false,
    });
  });
});

describe("restoredAttachmentToComposerItem", () => {
  const resolve = (raw: string | null | undefined) =>
    raw ? `https://api.test${raw}` : null;

  it("stages the server row as already-completed so it is not re-uploaded", () => {
    const item = restoredAttachmentToComposerItem(attachment, resolve);
    expect(item.status).toBe("completed");
    expect(item.id).toBe("att-1");
    expect(item.filename).toBe("diagram.png");
    expect(item.mimeType).toBe("image/png");
  });

  it("points the preview at the resolved server URL (no on-device file exists)", () => {
    expect(restoredAttachmentToComposerItem(attachment, resolve).localUri).toBe(
      "https://api.test/api/attachments/att-1/download",
    );
  });

  it("keys on the server id so two restores cannot collide", () => {
    expect(restoredAttachmentToComposerItem(attachment, resolve).localId).toBe(
      "restore:att-1",
    );
  });

  it("falls back to a generic mime type rather than an empty one", () => {
    const item = restoredAttachmentToComposerItem(
      { ...attachment, content_type: "" } as Attachment,
      resolve,
    );
    expect(item.mimeType).toBe("application/octet-stream");
  });
});
