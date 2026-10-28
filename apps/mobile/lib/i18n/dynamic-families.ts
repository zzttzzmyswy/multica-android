/**
 * Every i18n id this app builds at RUNTIME, declared as data.
 *
 * `locale-completeness.test.ts` can only see literal double-quoted keys, so
 * the families assembled by interpolation have never been checked by anything.
 * That gap is not theoretical: two of the nine `wakeups.ruleStates.*` leaves
 * shipped missing (`issue_closed`, `timed_out` — the state names are snake_case
 * and the dictionary spells them camelCase), and `autopilots.runStatus.*` lost
 * its `issue_created` leaf the same way. In both cases `translate()`'s last
 * resort is to echo the id, so the phone rendered
 * `wakeups.ruleStates.issue_closed` and `autopilots.runStatus.issue_created`
 * on screen while the correct copy sat unused in both bundles (MYS-2433).
 *
 * The fix has two halves, and both live here:
 *
 *   1. A wire value and its dictionary leaf are different vocabularies. That
 *      difference is recorded ONCE, per family, as a `Record<Union, string>`
 *      so the compiler — not a reviewer — notices a value with no leaf.
 *      `WAKEUP_STATE_KEYS` and `RUN_STATUS_KEYS` are the two families that
 *      actually disagree today; the rest are identity maps for the same
 *      reason, because a table you must update beats an interpolation nobody
 *      reviews.
 *   2. `DYNAMIC_FAMILIES` lists the full id set each family can produce, and
 *      `dynamic-families.test.ts` asserts every one of them resolves in BOTH
 *      bundles. A leaf renamed without renaming this table fails the suite
 *      instead of reaching a screen.
 *
 * Only TYPE imports appear in the import block below, never value imports:
 * this module is read by the Node vitest lane (no React Native), and a value
 * import of `wakeup-draft` / `autopilot-templates` would drag their runtime
 * graphs in with it.
 */
import type { AgentAvailability } from "@multica/core/agents";
import type { RuntimeHealth } from "@multica/core/runtimes";
import type {
  AgentTask,
  AutopilotExecutionMode,
  AutopilotRunSource,
  AutopilotRunStatus,
  AutopilotStatus,
  AutopilotTriggerKind,
  InboxItemType,
  IssuePriority,
  IssueStatusCategory,
  MemberRole,
  RuntimeUpdateStatus,
  WakeupScope,
  WakeupSource,
  WebhookDeliveryStatus,
  WebhookSignatureStatus,
} from "@multica/core/types";

import type { ActorProfileType } from "../../data/stores/actor-profile-store";
import type { ActorIssuesRelation } from "../actor-issues";
import type { AutopilotTemplateId } from "../autopilot-templates";
import type { RunNowBlockedKey } from "../autopilot-run-toast";
import type { RuntimeAccessScope } from "../runtime-access";
import type {
  WakeupAtPreset,
  WakeupField,
  WakeupRecurrence,
} from "../wakeup-draft";

/** The lifecycle state `wakeupState()` and `workspaceWakeupEndsText()` return.
 *  Web's names, in web's snake_case — `wakeupState` mirrors web's function and
 *  the tests assert these spellings, so they stay as they are. */
export type WakeupState =
  | "issue_closed"
  | "waiting"
  | "scheduled"
  | "paused"
  | "timed_out"
  | "disabled"
  | "triggered"
  | "expired"
  | "inactive";

/**
 * State name → the leaf the dictionary stores it under.
 *
 * Exhaustive over `WakeupState` on purpose: the dictionary camelCases these
 * and disagrees on exactly `issue_closed` / `timed_out`. Interpolating the
 * state name is what hid that, so this map is the only place the translation
 * happens.
 */
export const WAKEUP_STATE_KEYS: Record<WakeupState, string> = {
  issue_closed: "issueClosed",
  waiting: "waiting",
  scheduled: "scheduled",
  paused: "paused",
  timed_out: "timedOut",
  disabled: "disabled",
  triggered: "triggered",
  expired: "expired",
  inactive: "inactive",
};

/** The `wakeups.ruleStates.*` id for a lifecycle state. */
export function wakeupStateKey(state: WakeupState): string {
  return `wakeups.ruleStates.${WAKEUP_STATE_KEYS[state]}`;
}

/**
 * Run status → dictionary leaf. `issue_created` is the other snake_case wire
 * value the dictionary camelCases; the detail page used to interpolate the
 * status straight into the key and rendered the raw id for it.
 */
export const RUN_STATUS_KEYS: Record<AutopilotRunStatus, string> = {
  issue_created: "issueCreated",
  running: "running",
  completed: "completed",
  failed: "failed",
  skipped: "skipped",
};

/** The `autopilots.runStatus.*` id for a run status. */
export function runStatusKey(status: AutopilotRunStatus): string {
  return `autopilots.runStatus.${RUN_STATUS_KEYS[status]}`;
}

// ─── The rest of the runtime families ──────────────────────────────────────
// Identity maps, each exhaustive over the union its call site switches on, so
// a new server value is a compile error here rather than a raw id on a phone.

/** `enum.priority.*` */
export const PRIORITY_KEYS: Record<IssuePriority, string> = {
  urgent: "urgent",
  high: "high",
  medium: "medium",
  low: "low",
  none: "none",
};

/** `enum.status.*` — the seven built-in categories. A CUSTOM status carries a
 *  server-supplied name and never reaches this family. */
export const STATUS_CATEGORY_KEYS: Record<IssueStatusCategory, string> = {
  backlog: "backlog",
  todo: "todo",
  in_progress: "in_progress",
  in_review: "in_review",
  done: "done",
  blocked: "blocked",
  cancelled: "cancelled",
};

/** `enum.taskStatus.*` — every `AgentTask["status"]`. */
export const TASK_STATUS_KEYS: Record<AgentTask["status"], string> = {
  queued: "queued",
  dispatched: "dispatched",
  waiting_local_directory: "waiting_local_directory",
  deferred: "deferred",
  running: "running",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
};

/** `members.role.*` */
export const MEMBER_ROLE_KEYS: Record<MemberRole, string> = {
  owner: "owner",
  admin: "admin",
  member: "member",
};

/** `labels.scope.*` — the two scopes the label screens offer. `agent` is a
 *  label resource type with no scope pill, so it never reaches this family. */
export const LABEL_SCOPE_KEYS = {
  issue: "issue",
  skill: "skill",
} as const satisfies Record<string, string>;

/** `inbox.type.*` — every `InboxItemType`. */
export const INBOX_TYPE_KEYS: Record<InboxItemType, string> = {
  issue_assigned: "issue_assigned",
  issue_subscribed: "issue_subscribed",
  unassigned: "unassigned",
  assignee_changed: "assignee_changed",
  status_changed: "status_changed",
  priority_changed: "priority_changed",
  start_date_changed: "start_date_changed",
  due_date_changed: "due_date_changed",
  new_comment: "new_comment",
  mentioned: "mentioned",
  review_requested: "review_requested",
  task_completed: "task_completed",
  task_failed: "task_failed",
  agent_blocked: "agent_blocked",
  agent_completed: "agent_completed",
  reaction_added: "reaction_added",
  quick_create_done: "quick_create_done",
  quick_create_failed: "quick_create_failed",
  quick_create_unconfirmed: "quick_create_unconfirmed",
  autopilot_paused: "autopilot_paused",
  autopilot_quota_exceeded: "autopilot_quota_exceeded",
  children_done: "children_done",
};

/** `runtimes.health.*` — the derived four-way health. */
export const RUNTIME_HEALTH_KEYS: Record<RuntimeHealth, string> = {
  online: "online",
  recently_lost: "recently_lost",
  offline: "offline",
  about_to_gc: "about_to_gc",
};

/** `agents.availability.*` */
export const AGENT_AVAILABILITY_KEYS: Record<AgentAvailability, string> = {
  online: "online",
  unstable: "unstable",
  offline: "offline",
  archived: "archived",
};

/** `runtimes.update.status.*` */
export const RUNTIME_UPDATE_STATUS_KEYS: Record<RuntimeUpdateStatus, string> = {
  pending: "pending",
  running: "running",
  completed: "completed",
  failed: "failed",
  timeout: "timeout",
};

/** `runtimes.access.label.*` / `.choice.*` / `detail.visibility*.*` — the
 *  editor renders four families over these same three scopes. */
export const RUNTIME_ACCESS_SCOPE_KEYS: Record<RuntimeAccessScope, string> = {
  private: "private",
  public: "public",
  members: "members",
};

/** `profileCard.unavailable.*` */
export const PROFILE_UNAVAILABLE_KEYS: Record<ActorProfileType, string> = {
  member: "member",
  agent: "agent",
  squad: "squad",
};

/** `integrations.channel.*`. `ChannelKey` is declared per-screen rather than
 *  shared, so the union is restated here and the arrays below are typed. */
export const INTEGRATION_CHANNEL_IDS = [
  "lark",
  "slack",
  "dingtalk",
  "wecom",
] as const;

/** `autopilots.status.*` — the three wire statuses. A system pause swaps the
 *  plain "paused" word for `pausedRuntimeRequired`, which is added to the
 *  family's id list rather than typed as a status. */
export const AUTOPILOT_STATUS_KEYS: Record<AutopilotStatus, string> = {
  active: "active",
  paused: "paused",
  archived: "archived",
};

/** `autopilots.executionMode.*` — the wire value is snake_case. */
export const EXECUTION_MODE_KEYS: Record<AutopilotExecutionMode, string> = {
  create_issue: "createIssue",
  run_only: "runOnly",
};

/** `autopilots.runSource.*` */
export const RUN_SOURCE_KEYS: Record<AutopilotRunSource, string> = {
  schedule: "schedule",
  manual: "manual",
  webhook: "webhook",
  api: "api",
};

/** `autopilots.triggerKind.*` */
export const TRIGGER_KIND_KEYS: Record<AutopilotTriggerKind, string> = {
  schedule: "schedule",
  webhook: "webhook",
  api: "api",
};

/** `autopilots.deliveries.status.*` */
export const DELIVERY_STATUS_KEYS: Record<WebhookDeliveryStatus, string> = {
  queued: "queued",
  dispatched: "dispatched",
  rejected: "rejected",
  ignored: "ignored",
  failed: "failed",
};

/** `autopilots.deliveries.signature.*` */
export const DELIVERY_SIGNATURE_KEYS: Record<WebhookSignatureStatus, string> = {
  not_required: "not_required",
  valid: "valid",
  invalid: "invalid",
  missing: "missing",
};

/** `autopilots.wakeups.scopes.*` */
export const WAKEUP_SCOPE_KEYS: Record<WakeupScope, string> = {
  active: "active",
  all: "all",
  paused: "paused",
  disabled: "disabled",
  ended: "ended",
};

/** `autopilots.wakeups.sources.*` */
export const WAKEUP_SOURCE_KEYS: Record<WakeupSource, string> = {
  member: "member",
  agent: "agent",
  system: "system",
};

/** `autopilots.detail.<runBlocked>` — the six specific sentences
 *  `runNowBlockedKey()` can return plus the generic fallback. */
export const RUN_BLOCKED_KEYS: Record<RunNowBlockedKey, string> = {
  runBlockedInvocationNotAllowed: "runBlockedInvocationNotAllowed",
  runBlockedRuntimeOffline: "runBlockedRuntimeOffline",
  runBlockedAgentRuntimeRequired: "runBlockedAgentRuntimeRequired",
  runBlockedTargetUnavailable: "runBlockedTargetUnavailable",
  runBlockedAttribution: "runBlockedAttribution",
  runBlockedAlreadyActive: "runBlockedAlreadyActive",
  runBlockedGeneric: "runBlockedGeneric",
};

/** `wakeups.create.at_*` — the four time presets. */
export const WAKEUP_AT_PRESET_KEYS: Record<WakeupAtPreset, string> = {
  "10m": "at_10m",
  "1h": "at_1h",
  tomorrow: "at_tomorrow",
  custom: "at_custom",
};

/** `wakeups.create.<recurrence>` — the three recurrence choices. */
export const WAKEUP_RECURRENCE_KEYS: Record<WakeupRecurrence, string> = {
  hourly: "hourly",
  daily: "daily",
  weekdays: "weekdays",
};

/** `wakeups.create.field_*` — the four condition fields. */
export const WAKEUP_FIELD_KEYS: Record<WakeupField, string> = {
  status: "field_status",
  assignee: "field_assignee",
  label: "field_label",
  property: "field_property",
};

/** `actorIssues.empty.<relation>.{title,description}` */
export const ACTOR_ISSUES_EMPTY_KEYS = {
  assigned: { title: "assigned.title", description: "assigned.description" },
  created: { title: "created.title", description: "created.description" },
} as const satisfies Record<ActorIssuesRelation, { title: string; description: string }>;

/** `chat.onboardingCards.<card>.{title,prompt,desc}` — the three starter
 *  cards, restated from `onboarding-starter-cards.tsx` so the test can walk
 *  them without importing a React Native component. */
export const ONBOARDING_CARD_IDS = ["board", "delegate", "digest"] as const;

/** `autopilots.templates.<id>.{title,summary}` */
export const AUTOPILOT_TEMPLATE_IDS: readonly AutopilotTemplateId[] = [
  "daily_news",
  "pr_review",
  "bug_triage",
  "weekly_progress",
  "dependency_audit",
  "documentation_check",
];

/** `usage.range<days>` — the five dashboard windows. */
export const USAGE_RANGES = [1, 7, 30, 90, 180] as const;

/** `runtimes.machine.section_<section>` */
export const RUNTIME_MACHINE_SECTIONS = ["cloud", "local", "remote"] as const;

/** `skills.runtimeImport.<key>` — the counters the import summary prints. */
export const RUNTIME_IMPORT_SUMMARY_LEAVES = [
  "summaryCreated",
  "summaryUpdated",
  "summarySkipped",
  "summaryFailed",
] as const;

/** `wakeups.create.other_*` — the three states an `other_issue` rule can name. */
export const WAKEUP_OTHER_STATE_KEYS = ["done", "ended", "in_review"] as const;

/** `wakeups.system.blocked<X>` — the three reasons a system rule is parked.
 *  Note the capital first letter: the leaf is built by suffix, not by dot. */
export const SYSTEM_BLOCKED_LEAVES = ["Backlog", "Member", "None"] as const;

/** The seven weekday keys the schedule editor prints. Same order and spelling
 *  as `DAY_KEYS` in `schedule-editor-model`; restated so this module stays
 *  free of value imports. */
export const WEEKDAY_KEYS = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
] as const;

/**
 * The `failureReason.*` leaves this build can pick.
 *
 * Deliberately a SAMPLE, not the closed value set: `failure_reason` is an open
 * string that grows as classifier rules land, and `failureReasonLabel()`
 * degrades an unknown value to the local "failed" wording rather than leaking
 * the id — so there is no union to enumerate. These are the common reasons
 * plus the fallback the function itself uses.
 */
export const FAILURE_REASON_SAMPLE_LEAVES = [
  "failed",
  "timeout",
  "cancelled",
  "agent_blocked",
  "queued_expired",
  "runtime_offline",
  "agent_error",
  "agent_error.agent_timeout",
  "agent_error.provider_network",
  "agent_error.provider_quota_limit",
  "agent_error.runtime_missing_executable",
] as const;

function prefixed(prefix: string, leaves: Iterable<string>): readonly string[] {
  return Array.from(leaves, (leaf) => prefix + leaf);
}

/**
 * Family name → every fully-qualified id that family can produce at runtime.
 *
 * The family name is the shape the call site writes with its variable blanked
 * out, which is what makes a failure readable: the test names the family, and
 * the missing id says which branch broke.
 */
export const DYNAMIC_FAMILIES: Record<string, readonly string[]> = {
  "wakeups.ruleStates.<state>": prefixed(
    "wakeups.ruleStates.",
    Object.values(WAKEUP_STATE_KEYS),
  ),
  "autopilots.runStatus.<status>": prefixed(
    "autopilots.runStatus.",
    Object.values(RUN_STATUS_KEYS),
  ),
  "autopilots.runSource.<source>": prefixed(
    "autopilots.runSource.",
    Object.values(RUN_SOURCE_KEYS),
  ),
  "autopilots.triggerKind.<kind>": prefixed(
    "autopilots.triggerKind.",
    Object.values(TRIGGER_KIND_KEYS),
  ),
  "autopilots.status.<status>": [
    ...prefixed("autopilots.status.", Object.values(AUTOPILOT_STATUS_KEYS)),
    "autopilots.status.pausedRuntimeRequired",
  ],
  "autopilots.executionMode.<mode>": prefixed(
    "autopilots.executionMode.",
    Object.values(EXECUTION_MODE_KEYS),
  ),
  "autopilots.deliveries.status.<status>": prefixed(
    "autopilots.deliveries.status.",
    Object.values(DELIVERY_STATUS_KEYS),
  ),
  "autopilots.deliveries.signature.<status>": prefixed(
    "autopilots.deliveries.signature.",
    Object.values(DELIVERY_SIGNATURE_KEYS),
  ),
  "autopilots.detail.<runBlocked>": prefixed(
    "autopilots.detail.",
    Object.values(RUN_BLOCKED_KEYS),
  ),
  "autopilots.wakeups.scopes.<scope>": prefixed(
    "autopilots.wakeups.scopes.",
    Object.values(WAKEUP_SCOPE_KEYS),
  ),
  "autopilots.wakeups.sources.<source>": prefixed(
    "autopilots.wakeups.sources.",
    Object.values(WAKEUP_SOURCE_KEYS),
  ),
  "autopilots.templates.<id>.<leaf>": AUTOPILOT_TEMPLATE_IDS.flatMap((id) =>
    prefixed(
      "autopilots.templates.",
      ["title", "summary"].map((leaf) => `${id}.${leaf}`),
    ),
  ),
  "enum.priority.<priority>": prefixed(
    "enum.priority.",
    Object.values(PRIORITY_KEYS),
  ),
  "enum.status.<category>": prefixed(
    "enum.status.",
    Object.values(STATUS_CATEGORY_KEYS),
  ),
  "enum.taskStatus.<status>": prefixed(
    "enum.taskStatus.",
    Object.values(TASK_STATUS_KEYS),
  ),
  "members.role.<role>": prefixed(
    "members.role.",
    Object.values(MEMBER_ROLE_KEYS),
  ),
  "labels.scope.<scope>": prefixed(
    "labels.scope.",
    Object.values(LABEL_SCOPE_KEYS),
  ),
  "inbox.type.<type>": prefixed("inbox.type.", Object.values(INBOX_TYPE_KEYS)),
  "runtimes.health.<health>": prefixed(
    "runtimes.health.",
    Object.values(RUNTIME_HEALTH_KEYS),
  ),
  "runtimes.update.status.<status>": prefixed(
    "runtimes.update.status.",
    Object.values(RUNTIME_UPDATE_STATUS_KEYS),
  ),
  "runtimes.access.label.<scope>": prefixed(
    "runtimes.access.label.",
    Object.values(RUNTIME_ACCESS_SCOPE_KEYS),
  ),
  "runtimes.access.choice.<scope>": prefixed(
    "runtimes.access.choice.",
    Object.values(RUNTIME_ACCESS_SCOPE_KEYS),
  ),
  "runtimes.detail.visibilityHint.<scope>": prefixed(
    "runtimes.detail.visibilityHint.",
    Object.values(RUNTIME_ACCESS_SCOPE_KEYS),
  ),
  "runtimes.detail.visibilityReadonly.<scope>": prefixed(
    "runtimes.detail.visibilityReadonly.",
    Object.values(RUNTIME_ACCESS_SCOPE_KEYS),
  ),
  "runtimes.machine.section_<section>": RUNTIME_MACHINE_SECTIONS.map(
    (section) => `runtimes.machine.section_${section}`,
  ),
  "agents.availability.<availability>": prefixed(
    "agents.availability.",
    Object.values(AGENT_AVAILABILITY_KEYS),
  ),
  "profileCard.unavailable.<type>": prefixed(
    "profileCard.unavailable.",
    Object.values(PROFILE_UNAVAILABLE_KEYS),
  ),
  "integrations.channel.<channel>": prefixed(
    "integrations.channel.",
    INTEGRATION_CHANNEL_IDS,
  ),
  "skills.runtimeImport.<key>": prefixed(
    "skills.runtimeImport.",
    RUNTIME_IMPORT_SUMMARY_LEAVES,
  ),
  "failureReason.<reason>": prefixed(
    "failureReason.",
    FAILURE_REASON_SAMPLE_LEAVES,
  ),
  "usage.range<days>": USAGE_RANGES.map((days) => `usage.range${days}`),
  "wakeups.create.at_<preset>": prefixed(
    "wakeups.create.",
    Object.values(WAKEUP_AT_PRESET_KEYS),
  ),
  "wakeups.create.<recurrence>": prefixed(
    "wakeups.create.",
    Object.values(WAKEUP_RECURRENCE_KEYS),
  ),
  "wakeups.create.field_<field>": prefixed(
    "wakeups.create.",
    Object.values(WAKEUP_FIELD_KEYS),
  ),
  "wakeups.create.other_<state>": prefixed(
    "wakeups.create.",
    WAKEUP_OTHER_STATE_KEYS.map((state) => `other_${state}`),
  ),
  "wakeups.system.blocked<Reason>": SYSTEM_BLOCKED_LEAVES.map(
    (leaf) => `wakeups.system.blocked${leaf}`,
  ),
  "autopilots.schedule_editor.a11y.days_full.<day>": prefixed(
    "autopilots.schedule_editor.a11y.days_full.",
    WEEKDAY_KEYS,
  ),
  "autopilots.schedule_editor.days_short.<day>": prefixed(
    "autopilots.schedule_editor.days_short.",
    WEEKDAY_KEYS,
  ),
  "autopilots.schedule_editor.describe.days_long.<day>": prefixed(
    "autopilots.schedule_editor.describe.days_long.",
    WEEKDAY_KEYS,
  ),
  "actorIssues.empty.<relation>.<leaf>": Object.values(
    ACTOR_ISSUES_EMPTY_KEYS,
  ).flatMap(({ title, description }) =>
    prefixed("actorIssues.empty.", [title, description]),
  ),
  "chat.onboardingCards.<card>.<leaf>": ONBOARDING_CARD_IDS.flatMap((id) =>
    prefixed(
      "chat.onboardingCards.",
      ["title", "prompt", "desc"].map((leaf) => `${id}.${leaf}`),
    ),
  ),
};
