/**
 * Plain-language readback of a wakeup rule, ported from web's
 * `packages/views/issues/components/wakeup-presentation.ts` (MYS-2023).
 *
 * Why this file exists on the phone: the wakeup subsystem was at zero on
 * mobile. A user could see neither the rules an issue was waiting on nor the
 * wakeup events already sitting in its timeline — and those events rendered as
 * bare English enum strings (`wakeup_checkin`), because
 * `lib/format-activity.ts` falls through to `entry.action`.
 *
 * Scope is DELIBERATELY the read path. Creating, editing, enabling,
 * disabling and triggering rules all stay on web this iteration; see the
 * issue for why (revision-based optimistic concurrency, the
 * `expires_in_seconds` / `on_timeout` combination, and a nine-way condition
 * form are a write-surface worth its own round).
 *
 * Divergences from web, each deliberate:
 *   - Pure functions with an injected `t`, not hooks. Web's version is a hook
 *     because it reads five other hooks (locale, timezone, catalogs); mobile
 *     resolves those at the call site and passes the resolved text in, so this
 *     module stays testable under Node with no React or RN in the import
 *     chain. Same reason `lib/format-activity.ts` is a plain function.
 *   - `Intl`/relative-time formatting lives in the injected `WakeupText`
 *     implementation, not here: mobile's date helpers already own the
 *     locale + timezone contract (`lib/format-date.ts`).
 */
import type {
  AgentTask,
  Issue,
  IssueWakeup,
  SystemWakeup,
  WakeupCondition,
  WakeupPreview,
} from "@multica/core/types";
import { issueStatusCategoryOfIssue } from "./issue-status-catalog";

/** One rule's lifecycle state, as the section and the chip read it. The keys
 *  are the `wakeups.ruleStates.*` i18n ids. */
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
 * Which lifecycle state a rule is in. Mirrors web's `wakeupState`
 * (wakeup-presentation.ts:15) exactly, including the ordering: a closed issue
 * wins over everything, then "still enabled", and only then the four distinct
 * reasons a rule can be sitting still. Collapsing those reasons is the bug —
 * "turned off", "timed out", "paused by the platform" and "already fired" mean
 * four different things to the person deciding whether to intervene.
 */
export function wakeupState(
  w: Omit<IssueWakeup, "instruction">,
  closed = false,
  now = Date.now(),
): WakeupState {
  if (closed) return "issue_closed";
  if (w.enabled) return w.kind === "event" ? "waiting" : "scheduled";
  if (w.paused_reason) return "paused";
  if (w.timed_out_at) return "timed_out";
  if (w.disabled_at) return "disabled";
  if (w.last_task_id) return "triggered";
  if (w.kind === "at" && w.next_fire_at && Date.parse(w.next_fire_at) <= now)
    return "expired";
  return "inactive";
}

/**
 * Task statuses that mean "an agent is on this right now".
 *
 * `deferred` is included and is NOT in mobile's `AgentTask["status"]` union:
 * web's `isActiveWakeupRun` lists it, the server emits it, and mobile's
 * `AgentTaskSchema` maps any unrecognized status to `queued` (which is itself
 * active) — so the string is accepted here rather than cast away. Dropping it
 * would file a deferred run under "history" while it is still going to run.
 */
const ACTIVE_WAKEUP_RUN_STATUSES = new Set([
  "queued",
  "deferred",
  "dispatched",
  "running",
  "waiting_local_directory",
]);

export function isActiveWakeupRun(status?: string | null): boolean {
  return !!status && ACTIVE_WAKEUP_RUN_STATUSES.has(status);
}

/**
 * The run a rule started, for its row's "last execution" line.
 *
 * `wakeup_id` is the only link between a rule and its run. Verified live
 * against mu.zztweb.top: 23 tasks in the workspace carry it, and it is absent
 * from every task no rule started — so the `last_task_id` fallback below is
 * what a rule whose run already finished resolves through.
 */
export function wakeupRun(
  wakeup: IssueWakeup,
  tasks: readonly AgentTask[],
): AgentTask | undefined {
  return (
    tasks.find(
      (task) =>
        task.wakeup_id === wakeup.id && isActiveWakeupRun(task.status),
    ) ?? tasks.find((task) => task.id === wakeup.last_task_id)
  );
}

/**
 * Whether a rule still belongs in the section's "current" half rather than
 * under the collapsed history. A disabled rule whose run is still in flight
 * stays current — the agent is working, and filing it away would hide that.
 */
export function isCurrentWakeup(
  wakeup: IssueWakeup,
  task?: AgentTask,
): boolean {
  return (
    wakeup.enabled || isActiveWakeupRun(task?.status ?? wakeup.last_task_status)
  );
}

/** What the issue header says it is waiting for. */
export type PrimaryWakeup =
  | { kind: "rule"; rule: IssueWakeup; count: number }
  | { kind: "system"; rule: SystemWakeup; count: number }
  | { kind: "paused"; rule: IssueWakeup; count: number };

/**
 * Picks the one line the issue header shows. Mirrors web's `primaryWakeup`
 * (issue-wakeup-header-chip.tsx:20): the first rule waiting on an event or
 * condition, else the soonest scheduled one, else the sub-issue system rule.
 *
 * A rule the platform paused is shown ONLY when nothing else is waiting — it
 * needs a person to look at it, so it must not compete with a live rule for
 * the slot. `count` is every enabled rule (so the "+N" tells the truth about
 * what the chip is standing in for) except on the paused branch, where the
 * paused rule is the whole story.
 */
export function primaryWakeup(
  rules: readonly IssueWakeup[],
  system: readonly SystemWakeup[],
): PrimaryWakeup | null {
  const enabled = rules.filter((w) => w.enabled);
  const waiting = enabled.filter((w) => w.kind === "event");
  const scheduled = enabled
    .filter((w) => w.kind !== "event")
    .sort(
      (a, b) =>
        Date.parse(a.next_fire_at ?? "") - Date.parse(b.next_fire_at ?? ""),
    );
  // A system rule with no target would wake nobody, and a blocked one is
  // already explained by the issue's own state — neither is worth the slot.
  const systemRule = system.find((r) => r.enabled && !r.blocked && r.target);
  const count = enabled.length + (systemRule ? 1 : 0);
  const rule = waiting[0] ?? scheduled[0];
  if (rule) return { kind: "rule", rule, count };
  if (systemRule) return { kind: "system", rule: systemRule, count };
  const paused = rules.find((w) => !w.enabled && w.paused_reason);
  if (paused) return { kind: "paused", rule: paused, count: 1 };
  return null;
}

/**
 * Timeline entries the wakeup service and the child-done rule write.
 *
 * Pinned by test in both directions: this set and
 * `formatActivity`'s wakeup branches must agree, so adding an action here
 * without a sentence (or dropping one) fails the suite rather than shipping a
 * bare enum string to the user.
 */
export const WAKEUP_ACTIVITY_ACTIONS = new Set([
  "wakeup_created",
  "wakeup_triggered",
  "wakeup_timed_out",
  "wakeup_paused",
  "wakeup_checkin",
]);

/** Actions mobile must never let coalesce away, because each row carries its
 *  own audit facts. Mirrors web's `NEVER_COALESCE_ACTIONS` for the wakeup
 *  subset (issue-detail.tsx:1686). */
export const NEVER_COALESCE_WAKEUP_ACTIONS = new Set([
  "wakeup_created",
  "wakeup_triggered",
  "wakeup_timed_out",
  "wakeup_paused",
]);

/** A wakeup activity whose silence carries no time limit. Mirrors web's
 *  `NO_TIME_LIMIT_ACTIONS` addition (issue-detail.tsx:1684): a rule checking in
 *  every hour for a day produces one row with a ×N chip, not 24 rows. */
export const NO_TIME_LIMIT_WAKEUP_ACTIONS = new Set(["wakeup_checkin"]);

/**
 * The `details.wakeup` preview bag a timeline entry stores, in the shape the
 * text helpers read. Names come from the workspace directory, so the caller
 * passes the resolver in — the entry only carries ids.
 */
export interface StoredWakeupPreview {
  id?: string;
  kind?: IssueWakeup["kind"];
  mode?: IssueWakeup["mode"];
  event_types?: string[];
  agent_id?: string;
  timezone?: string;
  condition?: WakeupCondition;
  filter_actor_type?: "member" | "agent";
  filter_actor_id?: string;
  filter_agent_id?: string;
  interval_seconds?: number;
  cron_expression?: string;
  next_fire_at?: string;
  created_by?: string;
  created_by_agent_id?: string;
}

export type WakeupActorName = (type: string, id: string) => string;

export function previewOf(
  stored: StoredWakeupPreview,
  getActorName: WakeupActorName,
): WakeupPreview {
  return {
    id: stored.id ?? "",
    issue_id: "",
    agent_id: stored.agent_id ?? "",
    agent_name: stored.agent_id ? getActorName("agent", stored.agent_id) : "",
    kind: stored.kind ?? "event",
    mode: stored.mode ?? "once",
    event_types: stored.event_types ?? [],
    filter_task_id: null,
    filter_agent_name: stored.filter_agent_id
      ? getActorName("agent", stored.filter_agent_id)
      : null,
    filter_actor_type: stored.filter_actor_type ?? null,
    filter_actor_id: stored.filter_actor_id ?? null,
    filter_actor_name:
      stored.filter_actor_type && stored.filter_actor_id
        ? getActorName(stored.filter_actor_type, stored.filter_actor_id)
        : null,
    interval_seconds: stored.interval_seconds ?? null,
    cron_expression: stored.cron_expression ?? null,
    timezone: stored.timezone ?? "UTC",
    next_fire_at: stored.next_fire_at ?? null,
    condition: stored.condition ?? null,
  };
}

/**
 * The translated string layer over the decisions above. Web expresses this as
 * a hook returning twenty closures; mobile takes `t` and the catalog lookups
 * as arguments instead, for the same reason the rest of this module is pure —
 * `formatActivity` is called from a plain function that has no hook context,
 * and the activity formatter has to run under Node in tests.
 *
 * Only the pieces the READ surfaces use are here. Web's version also carries
 * the create form's copy (`schedule`, `frequency`, `timeout_then_*`), which
 * this round does not ship.
 */
export interface WakeupTextDeps {
  t: (id: string, params?: Record<string, string | number>) => string;
  /** Built-in statuses read in the viewer's language; custom ones by name. */
  statusLabel?: (statusKey: string) => string;
  /** Resolve a label id to its name, or undefined when it no longer exists. */
  labelName?: (id: string) => string | undefined;
  /** Resolve a property id to {name, options}, for property conditions. */
  property?: (id: string) =>
    | { name: string; config?: { options?: { id: string; name: string }[] } }
    | undefined;
  /** Resolve an actor id to its display name. */
  actorName?: (type: string, id: string) => string;
}

/** "In Review" for a built-in status key, else the raw key. */
function statusText(deps: WakeupTextDeps, key: string): string {
  return deps.statusLabel ? deps.statusLabel(key) : key;
}

/** Every sentence form of a wakeup condition. `wait` picks the "Waiting for
 *  …" voice used by the header chip; otherwise the rule voice. */
function conditionSentence(
  deps: WakeupTextDeps,
  c: WakeupCondition,
  wait: boolean,
): string {
  const { t } = deps;
  const K = wait ? "wakeups.wait" : "wakeups.cond";
  switch (c.type) {
    case "issue_field":
      switch (c.field) {
        case "status":
          return t(`${K}.status`, { status: statusText(deps, c.value) });
        case "assignee":
          return t(`${K}.assignee`, {
            name: deps.actorName
              ? deps.actorName(c.assignee_type, c.assignee_id)
              : c.assignee_id,
          });
        case "label":
          return t(`${K}.label`, {
            label:
              deps.labelName?.(c.label_id) ?? t("wakeups.cond.unknownLabel"),
          });
        case "property": {
          const property = deps.property?.(c.property_id);
          const raw = c.value;
          let value: string;
          if (typeof raw === "boolean") {
            value = raw
              ? t("wakeups.cond.checked")
              : t("wakeups.cond.unchecked");
          } else {
            const option = property?.config?.options?.find(
              (o) => o.id === raw,
            );
            value = option?.name ?? String(raw);
          }
          return t(`${K}.property`, {
            property: property?.name ?? t("wakeups.cond.unknownProperty"),
            value,
          });
        }
      }
      break;
    case "children_done":
      return c.stage
        ? t(`${K}.childrenStage`, { stage: c.stage })
        : t(`${K}.childrenAll`);
    case "pull_request":
      return t(c.event === "merged" ? `${K}.prMerged` : `${K}.prChecks`);
    case "other_issue":
      return t(
        c.state === "ended"
          ? `${K}.otherEnded`
          : c.state === "in_review"
            ? `${K}.otherInReview`
            : `${K}.otherDone`,
        { issue: c.identifier || t("wakeups.cond.anotherIssue") },
      );
  }
  return t(`${K}.childrenAll`);
}

/** The event a rule of kind `event` waits on, named for a person. */
export function wakeupEventName(
  deps: WakeupTextDeps,
  event: string,
  agent?: string,
): string {
  const subject = agent ?? deps.t("wakeups.agent_subject");
  const map: Record<string, string> = {
    "task.queued": "wakeups.conditions.runQueued",
    "task.dispatched": "wakeups.conditions.runDispatched",
    "task.started": "wakeups.conditions.runStarted",
    "task.deferred": "wakeups.conditions.runDeferred",
    "task.waiting_local_directory":
      "wakeups.conditions.runWaitingLocalDirectory",
    "issue.updated": "wakeups.conditions.issueUpdated",
    "issue.assignee_changed": "wakeups.conditions.assigneeChanged",
    "issue.parent_changed": "wakeups.conditions.parentChanged",
    "issue.project_changed": "wakeups.conditions.projectChanged",
    "issue.labels_changed": "wakeups.conditions.labelsChanged",
    "issue.properties_changed": "wakeups.conditions.propertiesChanged",
    "issue.metadata_changed": "wakeups.conditions.metadataChanged",
    "comment.updated": "wakeups.conditions.commentUpdated",
    "comment.deleted": "wakeups.conditions.commentDeleted",
    "comment.resolved": "wakeups.conditions.commentResolved",
    "comment.unresolved": "wakeups.conditions.commentUnresolved",
    "reaction.added": "wakeups.conditions.reactionAdded",
    "reaction.removed": "wakeups.conditions.reactionRemoved",
    "attachment.attached": "wakeups.conditions.attachmentAttached",
    "attachment.detached": "wakeups.conditions.attachmentDetached",
    "task.completed": "wakeups.conditions.runCompleted",
    "task.failed": "wakeups.conditions.runFailed",
    "task.cancelled": "wakeups.conditions.runCancelled",
    "comment.created": "wakeups.conditions.commentCreated",
    "issue.status_changed": "wakeups.conditions.statusChanged",
  };
  const key = map[event];
  return key
    ? deps.t(key, { agent: subject })
    : deps.t("wakeups.unknownEvent", { event });
}

/**
 * What a rule watches, as one sentence — the line the section shows as a row's
 * title and the timeline shows after "added a wakeup:".
 */
export function wakeupTrigger(
  deps: WakeupTextDeps,
  w: WakeupPreview,
): string {
  const { t } = deps;
  if (w.condition) return conditionSentence(deps, w.condition, false);
  if (w.kind === "every") {
    const seconds = w.interval_seconds ?? 0;
    if (seconds === 3600) return t("wakeups.hourly");
    if (seconds % 3600 === 0)
      return t("wakeups.everyHours", { hours: seconds / 3600 });
    if (seconds % 60 === 0)
      return t("wakeups.every", { minutes: seconds / 60 });
    return t("wakeups.everySeconds", { seconds });
  }
  // A cron readback would need the schedule editor's describe model, which is
  // an autopilot-surface dependency this round does not pull in. The raw
  // expression plus its zone is honest; the rule still reads as a schedule.
  if (w.kind === "cron")
    return `${w.cron_expression ?? ""} · ${w.timezone}`.trim();
  if (w.kind === "at")
    return w.next_fire_at
      ? t("wakeups.atTime", { time: formatWakeupTime(w.next_fire_at) })
      : t("wakeups.scheduledTime");
  const event = w.event_types[0] ?? "";
  const label = wakeupEventName(
    deps,
    event,
    w.filter_agent_name ?? undefined,
  );
  const withActor =
    w.filter_actor_name && !event.startsWith("task.")
      ? t("wakeups.byActor", { condition: label, agent: w.filter_actor_name })
      : label;
  const extra =
    w.event_types.length > 1 ? ` +${w.event_types.length - 1}` : "";
  const run = w.filter_task_id
    ? ` · ${t("wakeups.specificRun", { id: w.filter_task_id.slice(0, 8) })}`
    : "";
  return `${withActor}${run}${extra}`;
}

/**
 * When a rule fires, as an absolute instant in the APP's locale. Unlike web,
 * which formats in the viewer's chosen timezone, mobile has no timezone
 * preference for this surface — it reads the device's, which is what a phone
 * user expects. `formatWakeupTime` therefore takes no timezone argument.
 */
export function formatWakeupTime(value: string, locale?: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  // `undefined` is deliberate: mobile's date helpers subscribe to the app
  // locale and pass it in; a caller with no locale gets the device's, which is
  // the same fallback `lib/format-date.ts` documents.
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** Where a rule is in its lifecycle, in words. */
export function wakeupStateText(
  deps: WakeupTextDeps,
  w: IssueWakeup,
  closed = false,
): string {
  const key = wakeupState(w, closed);
  if (key === "scheduled" && w.next_fire_at)
    return deps.t("wakeups.nextAt", { time: formatWakeupTime(w.next_fire_at) });
  return deps.t(`wakeups.ruleStates.${key}`);
}

/** Why the platform, not a person, stopped a rule. */
export function wakeupPausedText(
  deps: WakeupTextDeps,
  w: Pick<IssueWakeup, "paused_reason" | "max_fires" | "fire_count">,
): string | null {
  if (w.paused_reason === "max_fires")
    return deps.t("wakeups.paused.maxFires", {
      count: w.max_fires ?? w.fire_count ?? 0,
    });
  if (w.paused_reason === "loop") return deps.t("wakeups.paused.loop");
  if (w.paused_reason === "rate") return deps.t("wakeups.paused.rate");
  return null;
}

/** The status of a rule's latest run, in words. */
export function wakeupRunStateText(
  deps: WakeupTextDeps,
  status?: string | null,
): string {
  if (!status) return deps.t("wakeups.noRun");
  const map: Record<string, string> = {
    queued: "wakeups.runStates.queued",
    deferred: "wakeups.runStates.deferred",
    dispatched: "wakeups.runStates.dispatched",
    running: "wakeups.runStates.running",
    waiting_local_directory: "wakeups.runStates.waitingLocalDirectory",
    completed: "wakeups.runStates.completed",
    failed: "wakeups.runStates.failed",
    cancelled: "wakeups.runStates.cancelled",
  };
  const key = map[status];
  // An unrecognized status is still a fact about the run — show it verbatim
  // rather than claiming there was no run.
  return key ? deps.t(key) : status;
}

/**
 * The header chip's one line: what the issue is waiting for, in a few words.
 * Mirrors web's `waiting` + `headline`.
 */
export function wakeupWaitingText(
  deps: WakeupTextDeps,
  w: WakeupPreview,
): string {
  const { t } = deps;
  if (w.condition) return conditionSentence(deps, w.condition, true);
  if (w.kind !== "event") {
    return w.next_fire_at
      ? t("wakeups.wait.time", {
          time: formatWakeupTime(w.next_fire_at),
          agent: w.agent_name,
        })
      : wakeupTrigger(deps, w);
  }
  const event = w.event_types[0] ?? "";
  if (w.event_types.length === 1 && event === "comment.created") {
    return w.filter_actor_type
      ? t("wakeups.wait.replyFrom", {
          name: w.filter_actor_name ?? t("wakeups.agent_subject"),
        })
      : t("wakeups.wait.replyAny");
  }
  if (
    w.event_types.every((e) =>
      ["task.completed", "task.failed", "task.cancelled"].includes(e),
    )
  ) {
    return w.filter_agent_name
      ? t("wakeups.wait.runEnd", { agent: w.filter_agent_name })
      : t("wakeups.wait.runEndAny");
  }
  return t("wakeups.waitingEvent");
}

/** "<agent> is waiting …"; a time rule already names its agent. */
export function wakeupHeadlineText(
  deps: WakeupTextDeps,
  w: WakeupPreview,
): string {
  if (w.kind !== "event" && w.next_fire_at) return wakeupWaitingText(deps, w);
  return deps.t("wakeups.wait.header", {
    agent: w.agent_name,
    what: wakeupWaitingText(deps, w),
  });
}

/**
 * Whether an issue is closed, which is what stops its wakeup rules
 * server-side — a closed issue cannot have a rule enabled (`closed_hint`).
 *
 * Derived from the CATEGORY, not the raw status key: `done` and `cancelled`
 * are categories, but a workspace can define custom statuses inside them
 * (MUL-6243), and those must read as closed too. An unresolvable category is
 * treated as open, so an unknown custom status never claims a rule has
 * stopped when it has not.
 */
export function isClosedIssue(
  issue: Pick<Issue, "status" | "status_category"> | null | undefined,
): boolean {
  if (!issue) return false;
  const category = issueStatusCategoryOfIssue(issue);
  return category === "done" || category === "cancelled";
}
