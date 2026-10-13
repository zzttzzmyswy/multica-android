/**
 * Source context (MYS-2137) — the rules, on the mobile side of the line.
 *
 * An issue can be opened FROM a comment: the server freezes the comment's
 * thread plus its issue into a snapshot, and every such issue carries that
 * snapshot back on its own payload as `source_context`. Two surfaces consume
 * this module and neither may disagree about it:
 *
 *  - the AUTHOR side, which offers "create a sub-issue from this comment" in
 *    the comment's action sheet and shows what the capture would carry before
 *    the member commits to it;
 *  - the READER side, which tells whoever opens that child where it came from,
 *    and whether the source has moved on since.
 *
 * Like `lib/issue-duplicates.ts`, this file stays free of `react-native` and
 * `@tanstack/*` so the Node vitest lane can cover every decision here
 * (`vitest.config.ts` includes `lib/**` and `data/**` only).
 *
 * ## What the server actually accepts (probed 2026-10-13, mu.zztweb.top)
 *
 * The web bundle's variable naming hints at a `manual` / `auto` pair; the live
 * server rejects `auto` outright with `{"error":"mode must be manual or
 * agent"}`. The two real modes are:
 *
 *  - `manual` — the member writes the title; the server creates the issue
 *    synchronously and returns it, snapshot attached.
 *  - `agent` — the member writes a `prompt` and picks an actor; the server
 *    enqueues a quick-create task and returns `{task_id}`. No issue exists yet.
 *
 * `capture_token` from the preview rides along on BOTH, and it is the whole
 * safety mechanism: when the source has changed since the preview was taken,
 * the server refuses with 409 `source_context_changed` instead of creating a
 * task from context the member never saw.
 */

import type {
  CommentSubIssuePreview,
  CommentSubIssueMode,
  Issue,
  IssueSourceContext,
  SourceContextChangeReason,
  TimelineEntry,
} from "@multica/core/types";

/**
 * The server's refusal code when the preview the member confirmed is no longer
 * valid (`server/internal/handler` source-context write path).
 *
 * Named here rather than written as a literal at the alert, so the string
 * cannot drift from the server's and a test can pin it — the same rule
 * `DUPLICATE_TARGET_IS_DUPLICATE` follows in `@multica/core/issues/duplicates`.
 */
export const SOURCE_CONTEXT_CHANGED_CODE = "source_context_changed";

/**
 * i18n id substituted for the server's own sentence on that refusal.
 *
 * The API's body ("source context preview is invalid; refresh and try again")
 * is written for a caller; this is the member-facing line, and it is the ONE
 * outcome of this write they can act on. It travels through the existing
 * `WRITE_FAILURE_CONFLICT_KEY` channel (`lib/write-failure.ts`) rather than a
 * new one — pinned to `SOURCE_CONTEXT_CHANGED_CODE` via
 * `WRITE_FAILURE_CONFLICT_CODE_KEY`, exactly as the revision conflict is, so
 * the substitution cannot leak onto an unrelated 409 from the same endpoint
 * (this route answers a bare 409 for a missing token too).
 */
export const SOURCE_CONTEXT_CHANGED_KEY = "sourceContext.changed";

/** Whether a failed create was refused because the source moved on.
 *
 *  Duck-typed on `status` + `body.code` rather than `instanceof ApiError`: this
 *  module stays free of `@/data/api` so the Node lane can load it, and it is
 *  the same read `write-failure.ts`'s `errorCodeOf` makes. Fails closed — a
 *  409 whose body carries no code is NOT reported as "the source changed",
 *  because that would put a "refresh and retry" instruction on a failure
 *  refreshing cannot fix.
 */
export function isSourceContextChangedError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ((error as { status?: unknown }).status !== 409) return false;
  const body = (error as { body?: unknown }).body;
  if (typeof body !== "object" || body === null) return false;
  return (body as { code?: unknown }).code === SOURCE_CONTEXT_CHANGED_CODE;
}

/** The two ways to open a task from a comment, in the order they are offered.
 *
 *  `manual` is first and is the default: it is the one whose outcome the member
 *  can see immediately (the issue exists when the call returns), and it is what
 *  a phone-sized confirm surface can actually collect. `agent` needs a prompt
 *  and an actor, so it is the heavier choice and is offered second.
 */
export function commentSubIssueModes(): {
  mode: CommentSubIssueMode;
  labelKey: string;
}[] {
  return [
    { mode: "manual", labelKey: "sourceContext.modeManual" },
    { mode: "agent", labelKey: "sourceContext.modeAgent" },
  ];
}

/**
 * Whether the "create sub-issue from this comment" action belongs in a given
 * timeline entry's action sheet.
 *
 * The live web bundle gates its menu item on exactly this
 * (`"comment" === h.comment_type`), and the gate is load-bearing rather than
 * cosmetic: the write endpoint is keyed on a COMMENT id, so an entry that is
 * not a comment — a status change, an assignment, another activity row —
 * has nothing to turn into a task and would produce a 404.
 *
 * A comment whose `comment_type` the server did not send is excluded too: an
 * absent type means "this build cannot tell what kind of entry this is", and
 * the honest answer there is to offer nothing rather than a button that fails.
 */
export function canCreateSubIssueFromComment(
  entry: Pick<TimelineEntry, "comment_type">,
): boolean {
  return entry.comment_type === "comment";
}

/**
 * Whether a preview read produced something the member can act on.
 *
 * A preview that parsed but carried no `capture_token` cannot be submitted —
 * the server needs the token to prove what was shown, and the create surface is
 * refused without one. `parseWithFallback` yields exactly that empty preview
 * when the response drifts, so this is the check that turns a drifted read into
 * a visible "could not load the preview" state instead of a create button that
 * fails on every tap.
 */
export function previewIsUsable(
  preview: CommentSubIssuePreview | undefined,
): boolean {
  return !!preview && preview.capture_token.length > 0;
}

/** Byte counts from the preview, formatted for the confirm surface.
 *
 *  Shown so a long thread is not silently truncated behind the member's back:
 *  the server caps the capture, and the caps are the honest way to say so.
 *  `Intl.NumberFormat` is available in both Hermes and Node, and the call is
 *  pinned to the app's own locale by the caller-supplied tag. */
export function formatCaptureBytes(bytes: number, locale: string): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * The reader side: what the banner above a comment-born issue should say.
 *
 * Returns `null` when the issue carries no snapshot worth drawing — which
 * covers both "this issue was not opened from a comment" (the common case, and
 * the reason the banner must be free) and "the snapshot did not parse".
 *
 * The three states are deliberately distinct, because collapsing them would
 * make the banner lie in one direction or the other:
 *
 *  - `deleted` — the source issue is gone. Destructive styling, no link
 *    (there is nothing to open), and web's own sentence
 *    (`source_context.issue_deleted_after_capture`).
 *  - `unknown` — the server could not check the source at all. Says so, and
 *    does NOT claim the snapshot is current. Web keeps this separate from
 *    `changed` for the same reason: "we could not check" and "we checked and it
 *    moved" are different facts, and reporting the first as the second would
 *    put a false warning on every issue during a partial outage.
 *  - `changed` — the snapshot is stale, and the reasons are named so the member
 *    knows WHAT moved without opening the source.
 *  - `unchanged` — the snapshot still describes the source. Quiet styling: this
 *    is the state the banner spends almost all its life in, and it still has a
 *    job (it says where the issue came from).
 */
export type SourceContextBanner =
  | { kind: "deleted" }
  | { kind: "unknown" }
  | { kind: "changed"; reasons: SourceContextChangeReason[] }
  | { kind: "unchanged" };

export function sourceContextBanner(
  issue: Pick<Issue, "source_context">,
): SourceContextBanner | null {
  const sc = issue.source_context;
  // A snapshot with no source issue to name is not a banner — it is the
  // fallback an older or drifted payload produces. Drawing a strip that says
  // "from (nothing)" would be worse than saying nothing.
  if (!sc || !sc.snapshot?.source_issue?.identifier) return null;
  if (sc.source_issue_state === "deleted") return { kind: "deleted" };
  if (sc.display_state === "unavailable") return { kind: "unknown" };
  if (sc.display_state === "changed") {
    return { kind: "changed", reasons: sc.change_reasons ?? [] };
  }
  return { kind: "unchanged" };
}

/** Where "open the current source" goes, or `null` when there is nowhere to go.
 *
 *  Reads `current_source` first and falls back to the snapshot: the server
 *  resolves `current_source` so the link follows a source issue that survived,
 *  and the snapshot is the capture-time value. `can_open_current_source ===
 *  false` means the live source is gone, and the banner then draws no link at
 *  all — a link to a deleted issue is a dead end the member would have to
 *  discover by tapping.
 *
 *  Both halves of the target are required. The anchor comment id is not
 *  optional: without it the link opens the right issue at the wrong place, and
 *  "which comment was this task opened from" is the entire question the banner
 *  exists to answer.
 */
export function sourceContextTarget(
  sc: IssueSourceContext | undefined,
): { issueId: string; anchorCommentId: string } | null {
  if (!sc) return null;
  if (sc.can_open_current_source === false) return null;
  const issueId = sc.current_source?.issue_id || sc.snapshot?.source_issue?.id;
  const anchorCommentId =
    sc.current_source?.anchor_comment_id || sc.snapshot?.anchor_comment_id;
  if (!issueId || !anchorCommentId) return null;
  return { issueId, anchorCommentId };
}

/** The identifier to name in the banner — the live one when the source was
 *  renamed, the captured one otherwise. Both are the same string on the
 *  overwhelmingly common path; they differ only when the source changed. */
export function sourceContextIdentifier(
  sc: IssueSourceContext | undefined,
): string {
  return sc?.current_source?.identifier || sc?.snapshot?.source_issue?.identifier || "";
}

/** The i18n id for one change reason, so the banner can name what moved.
 *
 *  A reason this build does not know maps to `null` and is dropped: the enum
 *  drifts forward (root CLAUDE.md "Enum drift downgrades, not crashes"), and
 *  the banner's generic sentence still covers it. */
export function changeReasonLabelKey(
  reason: SourceContextChangeReason,
): string | null {
  switch (reason) {
    case "issue_title":
      return "sourceContext.subjectIssueTitle";
    case "issue_description":
      return "sourceContext.subjectIssueDescription";
    case "issue_description_attachments":
      return "sourceContext.subjectIssueAttachments";
    case "comment_thread":
      return "sourceContext.subjectCommentThread";
    default:
      return null;
  }
}

/** How many comments the snapshot froze. Shown in the confirm surface as the
 *  "what you are about to carry" number. */
export function previewThreadSize(
  preview: CommentSubIssuePreview | undefined,
): number {
  return preview?.comment_thread.length ?? 0;
}
