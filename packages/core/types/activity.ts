import type { CommentAuthorType, Reaction } from "./comment";
import type { Attachment } from "./attachment";

export interface AssigneeFrequencyEntry {
  assignee_type: string;
  assignee_id: string;
  frequency: number;
}

export interface TimelineEntry {
  type: "activity" | "comment";
  id: string;
  actor_type: string;
  actor_id: string;
  created_at: string;
  // Activity fields
  action?: string;
  details?: Record<string, unknown>;
  // Comment fields
  content?: string;
  parent_id?: string | null;
  updated_at?: string;
  comment_type?: string;
  /** Set only on comments a quick action produced (MUL-5465). Unforgeable. */
  quick_action_id?: string | null;
  reactions?: Reaction[];
  attachments?: Attachment[];
  resolved_at?: string | null;
  resolved_by_type?: CommentAuthorType | null;
  resolved_by_id?: string | null;
  source_task_id?: string | null;
  /**
   * Set only on a comment deleted while it still had replies: the server keeps
   * it as an empty tombstone so the replies keep their parent. Servers that
   * hard-delete (this fork's `server/`) never send it, while the deployment the
   * mobile client talks to does — so every consumer has to tolerate it.
   *
   * The deliverables collection is one of them: a tombstoned comment renders no
   * files, so counting the attachments still attached to its row would report
   * output the reader cannot see anywhere (`attachments/deliverables.ts`).
   */
  deleted_at?: string | null;
  /** Set by frontend coalescing when consecutive identical activities are merged. */
  coalesced_count?: number;
}
