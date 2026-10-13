import type { Attachment } from "./attachment";
import type { Label } from "./label";
import type { IssuePropertyValues } from "./property";

/**
 * A status CATEGORY — the behavior equivalence class an issue's status belongs
 * to. There are exactly 7, and each is also the key of the built-in status that
 * defines it, which is why this stayed a closed union while `Issue.status`
 * became open. Board columns, filters and the presentation config are all keyed
 * off categories, so their shape is fixed no matter how many custom statuses a
 * workspace defines. (MUL-6243)
 */
export type IssueStatusCategory =
  | "backlog"
  | "todo"
  | "in_progress"
  | "in_review"
  | "done"
  | "blocked"
  | "cancelled";

/**
 * A status KEY as stored on the issue: one of the 7 built-ins, or a custom key
 * an admin defined for this workspace.
 *
 * OPEN by design. `(string & {})` keeps editor autocomplete for the 7 built-ins
 * while accepting any catalog key, which is what the server has always been
 * able to send. Anything that needs presentation (label, colour, board column)
 * must resolve the key to its CATEGORY first — `useIssueStatuses(wsId)` in a
 * component, `statusCategoryOfKey` in a pure path. (MUL-6243)
 */
export type IssueStatus = IssueStatusCategory | (string & {});

export type IssuePriority = "urgent" | "high" | "medium" | "low" | "none";

export type IssueAssigneeType = "member" | "agent" | "squad";

export interface IssueReaction {
  id: string;
  issue_id: string;
  actor_type: string;
  actor_id: string;
  emoji: string;
  created_at: string;
}

/**
 * Per-issue metadata is a flat KV map agents use to record pipeline state
 * (PR number, pipeline_status, waiting_on, ...). Values are primitives only —
 * string / number / bool — enforced by both the API and the DB. Always
 * present in responses (empty object when unset) so reads don't need a
 * nil guard on the parent field.
 */
export type IssueMetadataValue = string | number | boolean;
export type IssueMetadata = Record<string, IssueMetadataValue>;

/** The original a duplicate points at (MUL-7349): enough to link it and show
 *  its status, without fetching the whole issue.
 *
 *  Deliberately NOT an `Issue`: the server resolves only these four fields
 *  into `Issue.duplicate_of` (server/internal/handler/issue.go
 *  `fillDuplicateOf`), so typing it as a full Issue would promise fields the
 *  payload never carries and invite a reader to dereference `undefined`. */
export interface IssueDuplicateOf {
  id: string;
  identifier: string;
  title: string;
  status: IssueStatus;
}

/** Both sides of an issue's duplicate relation (MUL-7349) — its original, and
 *  the issues marked as duplicates of it. `GET /api/issues/:id/duplicates`. */
export interface IssueDuplicates {
  /** The original this issue duplicates, when it is marked as one. */
  duplicate_of: Issue | null;
  /** Issues marked as duplicates of this one. */
  duplicates: Issue[];
}

// ---------------------------------------------------------------------------
// Source context (MYS-2137) — an issue opened FROM a comment, plus the thread
// snapshot captured with it. Shapes below were probed against
// `mu.zztweb.top` on 2026-10-13 (GET /api/comments/:id/sub-issue-preview, and
// the `source_context` the issue payload carries once such a child exists).
// ---------------------------------------------------------------------------

/**
 * Why a captured snapshot no longer matches the live source.
 *
 * The server's own vocabulary (`change_reasons`). Enum drift downgrades rather
 * than crashes (root CLAUDE.md): a reason this build does not know is dropped
 * by the parser and the banner falls back to its generic "the source moved"
 * sentence, which stays true for a reason invented later.
 */
export type SourceContextChangeReason =
  | "issue_title"
  | "issue_description"
  | "issue_description_attachments"
  | "comment_thread";

/** How the live source compares with the snapshot taken at capture time.
 *  `unchanged` is the only value that lets the reader treat the snapshot as
 *  current; `unavailable` means the server could not check at all, which is
 *  distinct from `changed` and must not be reported as one. */
export type SourceContextDisplayState = "unchanged" | "changed" | "unavailable";

/** Whether the issue the snapshot was taken from still exists. */
export type SourceContextIssueState = "unchanged" | "deleted";

/** Whether the anchor comment still exists. */
export type SourceContextAnchorState = "available";

/** One comment in a captured thread, as the server froze it.
 *
 *  `id`/`created_at` survive so the banner can offer "open the current source"
 *  — the live comment is reachable by id even when its text has since moved on. */
export interface SourceContextComment {
  id: string;
  parent_id: string | null;
  type?: string;
  content: string;
  author: { type: string; id: string; name: string };
  created_at: string;
  updated_at?: string;
  revision?: number;
  attachments?: Attachment[];
  /** Set by the server when the comment was deleted after capture. */
  deleted?: boolean;
}

/** The issue side of a captured snapshot. Not a full `Issue`: the server
 *  resolves a fixed subset (probed), so typing it as one would promise fields
 *  the payload never carries. */
export interface SourceContextIssue {
  id: string;
  identifier: string;
  number: number;
  title: string;
  description: string | null;
  created_at?: string;
  updated_at?: string;
  revision?: number;
  attachments?: Attachment[];
}

/** The context frozen when a comment was turned into a sub-issue. */
export interface SourceContextSnapshot {
  version?: number;
  captured_by_user_id?: string;
  captured_at?: string;
  source_issue: SourceContextIssue;
  comment_thread: SourceContextComment[];
  anchor_comment_id: string;
}

/** An author whose display name changed since capture, or who has since left.
 *  `state` is the server's verdict; a value this build does not know is
 *  treated as unchanged. */
export interface SourceContextAuthorState {
  type: string;
  id: string;
  captured_name: string;
  current_name?: string;
  state: string;
}

/** Where the live source is now — what "open the current source" navigates to.
 *  Separate from `snapshot` because the source issue can be renamed, and the
 *  anchor comment can move to a different issue. */
export interface SourceContextCurrent {
  issue_id: string;
  identifier: string;
  anchor_comment_id: string;
}

/** What changed between the snapshot and the live source. */
export interface SourceContextChangeDetails {
  changed_comment_ids?: string[];
  removed_comment_ids?: string[];
  added_comments?: SourceContextComment[];
  description_attachment_changes?: unknown[];
}

/** The `source_context` a comment-born issue carries on its own payload.
 *
 *  `usage` is the server's own reminder that this is historical background:
 *  the snapshot is what the author saw at capture time, and it is NOT
 *  re-synced. Every reader has to present it as such. */
export interface IssueSourceContext {
  id: string;
  version?: number;
  usage?: string;
  captured_at?: string;
  display_state?: SourceContextDisplayState;
  source_issue_state?: SourceContextIssueState;
  comment_thread_state?: SourceContextDisplayState;
  anchor_comment_state?: SourceContextAnchorState;
  /** False when the live source is gone — the banner then shows no link. */
  can_open_current_source?: boolean;
  change_reasons?: SourceContextChangeReason[];
  change_details?: SourceContextChangeDetails;
  current_source?: SourceContextCurrent;
  source_author_state?: SourceContextAuthorState[];
  snapshot: SourceContextSnapshot;
}

/** `GET /api/comments/:id/sub-issue-preview` — what creating a sub-issue from
 *  this comment would carry, shown BEFORE the member commits to it. */
export interface CommentSubIssuePreview {
  source_issue: SourceContextIssue;
  comment_thread: SourceContextComment[];
  anchor_comment_id: string;
  /** Proof of what the member was shown. The server refuses the write with
   *  409 `source_context_changed` when the source has moved on since this
   *  token was minted, so it must ride along on the create. */
  capture_token: string;
  limits: CommentSubIssueLimits;
}

/** The caps the server applies to a capture. Shown in the confirm surface so
 *  a long thread is not silently truncated behind the member's back. */
export interface CommentSubIssueLimits {
  comment_count: number;
  text_bytes: number;
  attachment_count: number;
  attachment_bytes: number;
}

/** The two ways to open a task from a comment.
 *
 *  `manual` — the member writes the title/description; the server attaches the
 *  snapshot to the issue it creates and returns it.
 *  `agent` — an agent authors the issue from `prompt`; the server enqueues a
 *  quick-create task and returns `{task_id}`, so there is nothing to navigate
 *  to yet.
 *
 *  NOT `auto`, which the web bundle's `schema` naming might suggest: the live
 *  server answers `{"error":"mode must be manual or agent"}` for anything else
 *  (probed 2026-10-13). */
export type CommentSubIssueMode = "manual" | "agent";

/** Fields the `manual` mode create accepts. `parent_issue_id` is NOT among
 *  them — the server parents the new issue to the comment's own issue. */
export interface CommentSubIssueManualIssue {
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  assignee_type?: string | null;
  assignee_id?: string | null;
  project_id?: string | null;
}

/** Fields the `agent` mode create accepts. */
export interface CommentSubIssueQuickCreate {
  prompt: string;
  agent_id?: string;
  squad_id?: string;
  priority?: string;
  due_date?: string;
  project_id?: string | null;
}

export interface Issue {
  id: string;
  workspace_id: string;
  number: number;
  identifier: string;
  title: string;
  description: string | null;
  status: IssueStatus;
  /**
   * The category this issue's status behaves as, backfilled by the server. The
   * one question status-coupled product rules actually ask; absent on older
   * servers, in which case a built-in key IS its own category. (MUL-6243)
   */
  status_category?: IssueStatusCategory;
  priority: IssuePriority;
  assignee_type: IssueAssigneeType | null;
  assignee_id: string | null;
  creator_type: IssueAssigneeType;
  creator_id: string;
  parent_issue_id: string | null;
  /**
   * The original this issue duplicates (MUL-7349): present only while the
   * issue is cancelled and the original still exists, resolved by the server.
   * Absent when connected to an older backend.
   */
  duplicate_of?: IssueDuplicateOf | null;
  project_id: string | null;
  position: number;
  // Ordered barrier group among sibling sub-issues (null = unstaged). The
  // parent assignee is notified/woken only when every sub-issue in a stage
  // finishes; see server/internal/handler/issue_child_done.go.
  stage: number | null;
  // Calendar days as date-only "YYYY-MM-DD" (no time, no timezone). Use the
  // helpers in @multica/core/issues/date to format/compare — never `new Date()`
  // + local formatting, which shifts the day by the viewer's offset.
  start_date: string | null;
  due_date: string | null;
  metadata: IssueMetadata;
  // Custom property values keyed by property definition id. Always present
  // in responses (empty object when unset), mirroring `metadata`.
  properties: IssuePropertyValues;
  reactions?: IssueReaction[];
  labels?: Label[];
  created_at: string;
  updated_at: string;
  /** Monotonic server revision; absent when connected to an older backend.
   *
   *  Bumped by every issue write, and by any comment mutation on the issue
   *  (`UpdateComment` returns the new value as `Comment.issue_revision`). It is
   *  the token a whole-document editor echoes back as `expected_revision` so a
   *  concurrent edit is refused instead of overwritten — see
   *  `issues/revision-conflict.ts`. */
  revision?: number;
  /**
   * Where a comment-born sub-issue came from (MYS-2137), resolved by the
   * server into the issue payload the same way `duplicate_of` is. Present only
   * on an issue a source-context capture created.
   *
   * Deliberately NOT a full `Issue`: the server resolves this one field with
   * its own resolved shape (probed against mu.zztweb.top 2026-10-13), so
   * typing it as a whole issue would promise fields the payload never carries.
   * A server that predates the feature omits it, and every reader treats that
   * as "no source", not as an error.
   */
  source_context?: IssueSourceContext;
}
