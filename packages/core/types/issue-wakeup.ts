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
 * Scope was the READ path through MYS-2023/MYS-2031. `IssueWakeupInput` — the
 * body of `POST /api/issues/:id/wakeups` — arrives with MYS-2040, the round
 * that first sends one; the workspace-level `WorkspaceWakeup*` family is still
 * deliberately absent, because this fork ships no workspace wakeup table.
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

/** One issue's field or structural predicate the PLATFORM evaluates itself.
 *  A rule carrying one of these stores no raw `event_types` — the server
 *  refuses the combination ("a condition cannot be combined with events or
 *  filters", `issue_wakeup.go:154`), which is why `buildWakeupInput` sets one
 *  or the other and never both. */
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
 * The body of `POST /api/issues/:id/wakeups` (MYS-2040).
 *
 * Ported from upstream's own copy. Every optional field is optional because the
 * server derives a default for it, and the combinations it refuses are the ones
 * the form's decision layer refuses first (`lib/wakeup-draft.ts`): `at` with any
 * deadline or `on_timeout`, `expires_at` together with `expires_in_seconds`,
 * `max_fires` on a one-shot, and a `condition` beside raw events or filters.
 * The server re-validates all of it — this type only keeps the client from
 * building a body it can already know is wrong.
 */
export interface IssueWakeupInput {
  agent_id: string;
  instruction: string;
  kind: IssueWakeup["kind"];
  mode?: IssueWakeup["mode"];
  event_types?: string[];
  filter_agent_id?: string;
  filter_actor_type?: "member" | "agent";
  filter_actor_id?: string;
  at?: string;
  interval_seconds?: number;
  cron_expression?: string;
  timezone?: string;
  expires_at?: string;
  expires_in_seconds?: number;
  on_timeout?: "wake" | "end";
  condition?: WakeupCondition;
  max_fires?: number;
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


/**
 * One row of the WORKSPACE-wide wakeup table (MYS-2043), the shape behind
 * web's "任务唤醒" tab (`packages/views/autopilots/components/workspace-wakeups.tsx`).
 *
 * Same `IssueWakeup` fields minus `instruction` (the list does not carry the
 * prompt; every rule's prompt is edited through the per-rule endpoint), plus
 * the issue's own identity and the flags the table decides on: whether this
 * reader may manage the row at all, whether the issue is closed, how many runs
 * the rule started in the last seven days, and whether it came from a person,
 * an agent run, or the platform.
 */
export interface WorkspaceWakeup extends Omit<IssueWakeup, "instruction"> {
  issue_title: string;
  issue_identifier: string;
  issue_closed: boolean;
  /** False when this reader is neither the creator nor a workspace admin.
   *  The server computes it (handler `issue_wakeup.go:74-90`), so the row
   *  never re-derives permission from feel. */
  can_manage: boolean;
  active_runs: number;
  task: import("./agent").AgentTask | null;
  source: WakeupSource;
  /** Runs the rule started in the last seven days. */
  runs_7d: number;
  /** Set on a platform-rule row, whose `id` is the issue's own id. */
  rule?: SystemWakeup["rule"] | null;
  system_stage?: number | null;
  system_remaining?: number | null;
  target_type?: string | null;
}

export type WakeupSource = "member" | "agent" | "system";

/** The five scopes the table's segmented control offers, in web's order. */
export type WakeupScope = "active" | "all" | "paused" | "disabled" | "ended";

/** The payload of `GET /api/issue-wakeups`. */
export interface WorkspaceWakeupPage {
  items: WorkspaceWakeup[];
  total: number;
  /** Scope inventories, NOT result counts: they describe the whole workspace
   *  and never move when a filter narrows the page. */
  counts: Record<WakeupScope, number>;
  /** Every agent with a rule in this workspace, for the target filter. */
  agents: { id: string; name: string }[];
}

/**
 * The table's query string. Each field mirrors one server parameter; the
 * server validates every enum and answers 400 on an unknown value rather than
 * ignoring it (`issue_wakeup.go:27-56`).
 */
export interface WorkspaceWakeupFilters {
  scope: WakeupScope;
  kind: "all" | "event" | "at" | "recurring";
  source: "" | WakeupSource;
  search: string;
  agent_id: string;
  offset: number;
  limit: number;
}

/**
 * A platform rule's WORKSPACE default, edited in Settings (MYS-2043).
 * `customized` counts the open issues whose rule a person changed; those stop
 * following this default.
 */
export interface WorkspaceSystemWakeup {
  rule: "child_done";
  enabled: boolean;
  /** The workspace's instruction; empty means runs get `builtin_instruction`. */
  instruction: string;
  builtin_instruction: string;
  customized: number;
}
