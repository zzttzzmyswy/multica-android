/**
 * Wakeup-rule types (MYS-2023), ported from upstream `origin/main`'s
 * `packages/core/types/issue-wakeup.ts`.
 *
 * Why this fork carries its own copy: this is a mobile-only fork whose
 * `packages/core` is a frozen snapshot (5546 commits behind upstream), so the
 * wakeup subsystem the live server already serves has no type surface here.
 * Same precedent as every other core type this fork added for mobile
 * (`property.ts`, `issue-status.ts`, `activity.ts`).
 *
 * Scope is the READ path only. `IssueWakeupInput` and the workspace-level
 * `WorkspaceWakeup*` family are deliberately NOT ported: this iteration ships
 * no create/edit/enable/trigger surface, and a type for a request nobody sends
 * is a claim the client cannot honour. They come back with the write round.
 *
 * Every field below is verified present on the wire against mu.zztweb.top —
 * `GET /api/issues/:id/wakeups`, `/system-wakeups`, `.../wakeups/:id/runs`,
 * `GET /api/issue-wakeup-summaries` — not copied on faith from upstream.
 */

export interface IssueWakeup {
  id: string;
  issue_id: string;
  agent_id: string;
  agent_name: string;
  instruction: string;
  kind: "event" | "at" | "every" | "cron";
  mode: "once" | "continuous";
  event_types: string[];
  filter_agent_id: string | null;
  filter_task_id: string | null;
  filter_actor_type?: "member" | "agent" | null;
  filter_actor_id?: string | null;
  filter_actor_name?: string | null;
  interval_seconds: number | null;
  cron_expression: string | null;
  timezone: string;
  next_fire_at: string | null;
  enabled: boolean;
  revision?: number;
  disabled_at: string | null;
  last_task_id: string | null;
  last_error: string | null;
  filter_agent_name?: string | null;
  last_task_status?: string | null;
  /** When the rule ends if nothing triggered it first. */
  expires_at?: string | null;
  /** Set for relative waits: re-enabling restarts the wait from now. */
  expiry_seconds?: number | null;
  on_timeout?: "wake" | "end" | null;
  /** The deadline, not a trigger or a person, ended the rule. */
  timed_out_at?: string | null;
  /** True when an agent run created the rule on behalf of created_by_name. */
  created_by_agent?: boolean;
  created_by_name?: string | null;
  source_agent_id?: string | null;
  source_agent_name?: string | null;
  /** A fact the platform checks itself; null for event and time rules. */
  condition?: WakeupCondition | null;
  /** Repeating rules stop after this many runs. */
  max_fires?: number | null;
  fire_count?: number;
  /** Why the platform, not a person, stopped the rule. */
  paused_reason?: WakeupPausedReason | null;
}

export type WakeupPausedReason = "max_fires" | "loop" | "rate";

/** Structured predicates the platform evaluates (see WakeupCondition in Go). */
export type WakeupCondition =
  | { type: "issue_field"; field: "status"; value: string }
  | { type: "issue_field"; field: "assignee"; assignee_type: "member" | "agent" | "squad"; assignee_id: string }
  | { type: "issue_field"; field: "label"; label_id: string }
  | { type: "issue_field"; field: "property"; property_id: string; value: unknown }
  | { type: "children_done"; stage?: number | null }
  | { type: "pull_request"; event: "checks_finished" | "merged" }
  | { type: "other_issue"; issue_id: string; state: "done" | "ended" | "in_review"; identifier?: string };

/** One run a rule started, for its trigger history. */
export interface WakeupRun {  id: string;
  status: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  /** Set when a scheduled check ended silently. */
  checkin_note: string;
  triggers: string[];
  commented: boolean;
}

/**
 * The subset of a rule needed to describe what it waits for, with none of the
 * lifecycle fields. A timeline entry stores exactly this much of the rule it
 * came from, so the activity formatter can say what a past wakeup was watching
 * even after the rule itself is edited or deleted.
 */
export type WakeupPreview = Pick<
  IssueWakeup,
  | "id"
  | "issue_id"
  | "agent_id"
  | "agent_name"
  | "kind"
  | "mode"
  | "event_types"
  | "filter_task_id"
  | "filter_agent_name"
  | "filter_actor_type"
  | "filter_actor_id"
  | "filter_actor_name"
  | "interval_seconds"
  | "cron_expression"
  | "timezone"
  | "next_fire_at"
  | "condition"
>;

/**
 * A platform-defined wakeup on one issue. `child_done` wakes the parent's
 * assignee when a stage of its sub-issues closes while a later one waits, and
 * once more when every sub-issue is closed.
 */
export interface SystemWakeup {
  /** Empty until the rule exists on the issue (first sub-issue change or edit). */
  id: string;
  revision: number;
  rule: "child_done";
  enabled: boolean;
  /** Set on this issue; runs get `default_instruction` when it is empty. */
  instruction: string;
  default_instruction: string;
  /** A person changed the rule on this issue; it no longer follows the default. */
  customized: boolean;
  paused_reason: WakeupPausedReason | null;
  /** True while a stage is open; otherwise the rule waits for every sub-issue. */
  staged: boolean;
  stage: number | null;
  total: number;
  remaining: number;
  waiting: string[];
  target: { type: "agent" | "squad" | "member"; id: string; name: string } | null;
  /** Why no run would start now; a member assignee gets an inbox notification. */
  blocked: "" | "backlog" | "member_assignee" | "no_assignee";
  /** The workspace-wide setting, which applies until the issue sets its own. */
  workspace_default: boolean;
}

