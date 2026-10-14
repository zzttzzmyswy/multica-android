import { describe, expect, it } from "vitest";
import type {
  CommentSubIssuePreview,
  IssueSourceContext,
} from "@multica/core/types";
import {
  SOURCE_CONTEXT_CHANGED_CODE,
  canCreateSubIssueFromComment,
  changeReasonLabelKey,
  commentSubIssueModes,
  formatCaptureBytes,
  isSourceContextChangedError,
  previewIsUsable,
  previewThreadSize,
  sourceContextBanner,
  sourceContextIdentifier,
  sourceContextTarget,
} from "./source-context";

/** A `source_context` exactly as the live server sends it
 *  (probed mu.zztweb.top 2026-10-13). */
function context(over: Partial<IssueSourceContext> = {}): IssueSourceContext {
  return {
    id: "01a13638-9cd1-7be3-b8bc-0078a453e42c",
    version: 1,
    usage: "read_only_historical_background",
    display_state: "unchanged",
    source_issue_state: "unchanged",
    comment_thread_state: "unchanged",
    anchor_comment_state: "available",
    can_open_current_source: true,
    change_reasons: [],
    change_details: { changed_comment_ids: [], description_attachment_changes: [] },
    current_source: {
      issue_id: "01a13638-9983-7337-9066-b37476ad7d57",
      identifier: "MYS-2138",
      anchor_comment_id: "01a13638-9b6c-76b7-9922-148df828233a",
    },
    snapshot: {
      source_issue: {
        id: "01a13638-9983-7337-9066-b37476ad7d57",
        identifier: "MYS-2138",
        number: 2138,
        title: "fixture",
        description: "d",
      },
      comment_thread: [],
      anchor_comment_id: "01a13638-9b6c-76b7-9922-148df828233a",
    },
    ...over,
  };
}

function preview(over: Partial<CommentSubIssuePreview> = {}): CommentSubIssuePreview {
  return {
    source_issue: { id: "i", identifier: "MYS-1", number: 1, title: "t", description: null },
    comment_thread: [],
    anchor_comment_id: "c",
    capture_token: "sha256:abc:def",
    limits: { comment_count: 1, text_bytes: 100, attachment_count: 0, attachment_bytes: 0 },
    ...over,
  };
}

describe("isSourceContextChangedError", () => {
  it("recognises the refusal the live server sends", () => {
    // Verbatim body from `POST /api/comments/:id/sub-issues` with a token that
    // no longer matches (probed 2026-10-13).
    expect(
      isSourceContextChangedError({
        status: 409,
        body: {
          code: SOURCE_CONTEXT_CHANGED_CODE,
          error: "source context preview is invalid; refresh and try again",
        },
      }),
    ).toBe(true);
  });

  it("does NOT claim a bare 409 is the source moving on", () => {
    // This route answers 409 for a MISSING token as well as a stale one. The
    // two need different sentences: refreshing fixes a stale token and cannot
    // fix an absent one, so the narrower code is what the substitution keys on.
    expect(isSourceContextChangedError({ status: 409 })).toBe(false);
    expect(isSourceContextChangedError({ status: 409, body: {} })).toBe(false);
    expect(
      isSourceContextChangedError({ status: 409, body: { code: "something_else" } }),
    ).toBe(false);
  });

  it("ignores every non-409 failure", () => {
    expect(isSourceContextChangedError({ status: 400, body: { code: SOURCE_CONTEXT_CHANGED_CODE } })).toBe(false);
    expect(isSourceContextChangedError({ status: 500 })).toBe(false);
    expect(isSourceContextChangedError(new Error("boom"))).toBe(false);
    expect(isSourceContextChangedError(null)).toBe(false);
    expect(isSourceContextChangedError(undefined)).toBe(false);
    expect(isSourceContextChangedError("409")).toBe(false);
  });
});

describe("canCreateSubIssueFromComment", () => {
  it("offers the action on a plain comment", () => {
    expect(canCreateSubIssueFromComment({ comment_type: "comment" })).toBe(true);
  });

  it("offers nothing on a non-comment timeline entry", () => {
    // The write endpoint is keyed on a comment id. An activity row has no
    // comment to capture, and offering the action there produces a 404.
    for (const type of ["status_change", "assignment", "wakeup", "run", "activity"]) {
      expect(canCreateSubIssueFromComment({ comment_type: type })).toBe(false);
    }
  });

  it("offers nothing when the server sent no comment_type at all", () => {
    // "Cannot tell what this entry is" is not a reason to offer a button that
    // would fail; it is a reason to offer none.
    expect(canCreateSubIssueFromComment({})).toBe(false);
    expect(canCreateSubIssueFromComment({ comment_type: undefined })).toBe(false);
  });
});

describe("previewIsUsable", () => {
  it("accepts a preview carrying a capture token", () => {
    expect(previewIsUsable(preview())).toBe(true);
  });

  it("rejects the empty fallback a drifted read produces", () => {
    // `parseWithFallback` yields `capture_token: ""`. Submitting that is a
    // guaranteed failure, so the surface must show "could not load" instead of
    // an enabled create button.
    expect(previewIsUsable(preview({ capture_token: "" }))).toBe(false);
    expect(previewIsUsable(undefined)).toBe(false);
  });
});

describe("sourceContextBanner", () => {
  it("reads an unchanged snapshot as unchanged", () => {
    expect(sourceContextBanner({ source_context: context() })).toEqual({
      kind: "unchanged",
    });
  });

  it("names the reasons when the source moved on", () => {
    const banner = sourceContextBanner({
      source_context: context({
        display_state: "changed",
        comment_thread_state: "changed",
        change_reasons: ["comment_thread", "issue_title"],
      }),
    });
    expect(banner).toEqual({
      kind: "changed",
      reasons: ["comment_thread", "issue_title"],
    });
  });

  it("keeps 'we could not check' apart from 'we checked and it moved'", () => {
    // Reporting `unavailable` as `changed` would put a false warning on every
    // issue the moment the server cannot reach the source.
    expect(
      sourceContextBanner({ source_context: context({ display_state: "unavailable" }) }),
    ).toEqual({ kind: "unknown" });
  });

  it("reports a deleted source as deleted, ahead of any other state", () => {
    expect(
      sourceContextBanner({
        source_context: context({
          source_issue_state: "deleted",
          display_state: "changed",
          change_reasons: ["issue_title"],
        }),
      }),
    ).toEqual({ kind: "deleted" });
  });

  it("draws nothing for an issue that was not opened from a comment", () => {
    expect(sourceContextBanner({})).toBeNull();
    expect(sourceContextBanner({ source_context: undefined })).toBeNull();
  });

  it("draws nothing when the snapshot carries no source identifier", () => {
    // The shape a drifted or half-parsed payload leaves behind. A strip saying
    // "from (nothing)" is worse than no strip.
    const bare = context();
    bare.snapshot.source_issue.identifier = "";
    expect(sourceContextBanner({ source_context: bare })).toBeNull();
    expect(
      sourceContextBanner({
        source_context: { ...context(), snapshot: undefined } as unknown as IssueSourceContext,
      }),
    ).toBeNull();
  });
});

describe("sourceContextTarget", () => {
  it("prefers the live source over the captured one", () => {
    // The source can be renamed and the anchor comment can be re-parented;
    // `current_source` is the server's answer for where it is NOW.
    expect(
      sourceContextTarget(
        context({
          current_source: { issue_id: "live", identifier: "MYS-9", anchor_comment_id: "c-live" },
        }),
      ),
    ).toEqual({ issueId: "live", anchorCommentId: "c-live" });
  });

  it("falls back to the snapshot when the server sent no current_source", () => {
    expect(
      sourceContextTarget(context({ current_source: undefined })),
    ).toEqual({
      issueId: "01a13638-9983-7337-9066-b37476ad7d57",
      anchorCommentId: "01a13638-9b6c-76b7-9922-148df828233a",
    });
  });

  it("returns no target when the live source is gone", () => {
    // A link to a deleted issue is a dead end the member would only discover by
    // tapping it.
    expect(
      sourceContextTarget(context({ can_open_current_source: false })),
    ).toBeNull();
  });

  it("returns no target without an anchor comment", () => {
    // The anchor is the entire point of the link. Without it the member lands
    // on the right issue with no idea which comment the task came from.
    expect(
      sourceContextTarget(context({ current_source: undefined, snapshot: {
        source_issue: { id: "i", identifier: "MYS-1", number: 1, title: "t", description: null },
        comment_thread: [],
        anchor_comment_id: "",
      } })),
    ).toBeNull();
    expect(sourceContextTarget(undefined)).toBeNull();
  });
});

describe("sourceContextIdentifier", () => {
  it("names the live identifier, falling back to the captured one", () => {
    expect(sourceContextIdentifier(context())).toBe("MYS-2138");
    expect(
      sourceContextIdentifier(
        context({
          current_source: { issue_id: "i", identifier: "MYS-77", anchor_comment_id: "c" },
        }),
      ),
    ).toBe("MYS-77");
    expect(sourceContextIdentifier(context({ current_source: undefined }))).toBe("MYS-2138");
    expect(sourceContextIdentifier(undefined)).toBe("");
  });
});

describe("changeReasonLabelKey", () => {
  it("names each reason the server can send", () => {
    expect(changeReasonLabelKey("issue_title")).toBe("sourceContext.subjectIssueTitle");
    expect(changeReasonLabelKey("issue_description")).toBe("sourceContext.subjectIssueDescription");
    expect(changeReasonLabelKey("issue_description_attachments")).toBe(
      "sourceContext.subjectIssueAttachments",
    );
    expect(changeReasonLabelKey("comment_thread")).toBe("sourceContext.subjectCommentThread");
  });

  it("drops a reason this build does not know", () => {
    // Enum drift downgrades rather than crashes; the banner's generic sentence
    // still covers an unknown reason.
    expect(changeReasonLabelKey("issue_project" as never)).toBeNull();
    expect(changeReasonLabelKey("" as never)).toBeNull();
  });
});

describe("commentSubIssueModes", () => {
  it("offers manual first, then agent", () => {
    // `manual` creates the issue synchronously, so it is the mode whose outcome
    // the member sees immediately; `agent` is the heavier second choice.
    expect(commentSubIssueModes().map((m) => m.mode)).toEqual(["manual", "agent"]);
  });

  it("never offers `auto`, which the live server rejects outright", () => {
    // `{"error":"mode must be manual or agent"}` — probed 2026-10-13.
    expect(commentSubIssueModes().some((m) => (m.mode as string) === "auto")).toBe(false);
  });
});

describe("formatCaptureBytes", () => {
  it("formats each magnitude", () => {
    expect(formatCaptureBytes(0, "en")).toBe("0 B");
    expect(formatCaptureBytes(999, "en")).toBe("999 B");
    expect(formatCaptureBytes(1024, "en")).toBe("1 KB");
    expect(formatCaptureBytes(21761, "en")).toBe("21 KB");
    expect(formatCaptureBytes(2 * 1024 * 1024, "en")).toBe("2.0 MB");
  });

  it("never renders a negative or non-finite size", () => {
    expect(formatCaptureBytes(-1, "en")).toBe("0 B");
    expect(formatCaptureBytes(Number.NaN, "en")).toBe("0 B");
    expect(formatCaptureBytes(Number.POSITIVE_INFINITY, "en")).toBe("0 B");
  });
});

describe("previewThreadSize", () => {
  it("counts the frozen comments, and reads an absent preview as none", () => {
    expect(previewThreadSize(preview())).toBe(0);
    expect(
      previewThreadSize(
        preview({
          comment_thread: [
            {
              id: "a",
              parent_id: null,
              content: "x",
              author: { type: "member", id: "u", name: "n" },
              created_at: "t",
            },
          ],
        }),
      ),
    ).toBe(1);
    expect(previewThreadSize(undefined)).toBe(0);
  });
});
