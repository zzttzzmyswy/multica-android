export type CommentType = "comment" | "status_change" | "progress_update" | "system";

export type CommentAuthorType = "member" | "agent";

export interface Comment {
  id: string;
  issue_id: string;
  author_type: CommentAuthorType;
  author_id: string;
  content: string;
  type: CommentType;
  created_at: string;
  updated_at: string;
}
