/**
 * The decisions behind the wakeup CREATE form (MYS-2040).
 *
 * MYS-2023 put the wakeup rules ON the phone (read), MYS-2031 made them
 * actionable (enable / disable / wake now / edit / delete). Both rounds left
 * one thing at zero: there was no way to CREATE a rule from the app. A phone
 * user could stop a rule and could not start one.
 *
 * This module is the create half's decision layer, ported from web's
 * `packages/views/issues/components/wakeup-draft.ts` — the catalog of the 25
 * issue-scoped events, the draft shape, the nine-way condition model, and the
 * mapping from a draft to the request body the server accepts.
 *
 * Why it is a separate, React-free module: `vitest.config.ts` runs a Node-only
 * lane with no renderer, so a decision written inside JSX cannot be tested at
 * all. It is also this round's must-agree point with web — same draft, same
 * `IssueWakeupInput` or same error code — and web's own suite is the source of
 * the expectations in `wakeup-draft.test.ts`.
 *
 * Divergences from web, each deliberate:
 *
 *   - **Byte counts, not character counts.** Web measures the instruction with
 *     `new TextEncoder().encode(s).length`; the server counts `len()`, which is
 *     also bytes. This reuses `utf8ByteLength` from `lib/wakeup-controls.ts`
 *     (MYS-2031) so the two write paths cannot measure the same string two
 *     ways — and so a 4,001-character Chinese prompt (12,003 bytes) is refused
 *     here instead of by the server.
 *   - **Local date-time strings are parsed by component, not by the runtime.**
 *     Web relies on `new Date("2026-09-24T15:01")` reading as LOCAL time. That
 *     is what the spec says and what Node and JSC do; Hermes' date parsing is
 *     narrower, and a UTC reading would silently move a user's 15:01 wakeup by
 *     their whole offset. `parseLocalDateTime` splits the fields and builds the
 *     Date from components, so the meaning never depends on the engine. For a
 *     well-formed value the resulting instant is identical to web's.
 *   - **`isEventCondition` is a type guard.** Web's takes `WakeupCondition |
 *     null` and returns boolean; here it narrows to the subset of conditions
 *     that carry a deadline, so the caller that renders the trigger-count /
 *     wait / timeout block cannot forget the null case.
 */
import type { IssueWakeupInput, WakeupCondition } from "@multica/core/types";
import { WAKEUP_INSTRUCTION_MAX_BYTES, utf8ByteLength } from "./wakeup-controls";

/** The 25 issue-scoped events, in catalog order.
 *
 *  Verified against the live server's own catalog rather than copied on faith:
 *  `server/internal/service/issue_wakeup.go`'s `WakeupEventTypes` is the list
 *  the create endpoint validates against, and it is the same 25 strings. Any
 *  one of them missing here is a rule the app cannot express; any extra is a
 *  400 naming an unsupported event. */
export const WAKEUP_EVENT_TYPES = [
  "task.queued",
  "task.dispatched",
  "task.started",
  "task.deferred",
  "task.waiting_local_directory",
  "task.completed",
  "task.failed",
  "task.cancelled",
  "issue.updated",
  "issue.status_changed",
  "issue.assignee_changed",
  "issue.parent_changed",
  "issue.project_changed",
  "issue.labels_changed",
  "issue.properties_changed",
  "issue.metadata_changed",
  "comment.created",
  "comment.updated",
  "comment.deleted",
  "comment.resolved",
  "comment.unresolved",
  "reaction.added",
  "reaction.removed",
  "attachment.attached",
  "attachment.detached",
] as const;

/** What "an agent's run ends" expands to. The server has no single event for
 *  it, and the three are exactly web's. */
const RUN_END_EVENTS = ["task.completed", "task.failed", "task.cancelled"];

/** The nine condition choices, grouped in the picker as web groups them. */
export type WakeupConditionChoice =
  | "at"
  | "recurring"
  | "reply"
  | "field"
  | "run_end"
  | "children"
  | "pull_request"
  | "other_issue"
  | "custom";

export type WakeupField = "status" | "assignee" | "label" | "property";
export type WakeupAtPreset = "10m" | "1h" | "tomorrow" | "custom";
export type WakeupRecurrence = "hourly" | "daily" | "weekdays";

/** The wait and fire-count ladders, in the rungs web offers. Every value a
 *  multiple of a day/run so the label reads naturally, and every rung inside the
 *  server's own windows: `expires_in_seconds` must be 60…31,536,000
 *  (`issue_wakeup.go:93`), so 30 days is the ceiling, and `max_fires` must be
 *  1…1000 (`:144`). */
export const WAKEUP_WAIT_DAYS = [1, 3, 7, 30] as const;

/** The "up to N times" ladder. Only meaningful on a repeating rule — the
 *  server refuses `max_fires` on a one-shot (`issue_wakeup.go:144`). */
export const WAKEUP_MAX_FIRES = [5, 10, 20, 50] as const;

/**
 * Whether the draft would wake the issue's own agent assignee on members'
 * comments — which the platform ALREADY does, so the server folds such a
 * firing into that run instead of starting a second one.
 *
 * Load-bearing, not cosmetic: the form shows an explanatory line when this is
 * true, and web shows the same one. A wrong `true` tells the user their rule is
 * redundant when it is not; a wrong `false` hides the fact that a rule will
 * join a run rather than start one.
 */
export function wakesAssigneeOnComments(
  draft: Pick<WakeupDraft, "condition" | "replyActor" | "events" | "agentId">,
  assigneeAgentId: string | null,
): boolean {
  if (!assigneeAgentId || draft.agentId !== assigneeAgentId) return false;
  if (draft.condition === "reply") return draft.replyActor?.type !== "agent";
  return draft.condition === "custom" && draft.events.includes("comment.created");
}

/** The condition → i18n suffix map. `_`-free by construction: the suffix is
 *  interpolated into a key, so a value with a dot or a dash would produce a
 *  key no bundle has. `custom` maps to `custom` rather than the enum name so
 *  the copy can say "Custom events…" without the key reading oddly. */
const CONDITION_KEY_SUFFIX: Record<WakeupConditionChoice, string> = {
  at: "at",
  recurring: "recurring",
  reply: "reply",
  field: "field",
  run_end: "run_end",
  children: "children",
  pull_request: "pr",
  other_issue: "issue",
  custom: "custom",
};

/** The nine choices in the order the picker groups them — web's
 *  `ConditionMenu` groups, which are the form's information architecture rather
 *  than cosmetics: "Time" first because the two scheduled choices are the most
 *  used, and "custom" last and alone because it is the escape hatch. A group
 *  key that resolves to nothing would render an empty heading, so the test
 *  beside this module resolves all four. */
export const WAKEUP_CONDITION_GROUPS: readonly {
  groupKey: string;
  conditions: readonly WakeupConditionChoice[];
}[] = [
  { groupKey: "wakeups.create.group_time", conditions: ["at", "recurring"] },
  {
    groupKey: "wakeups.create.group_collaboration",
    conditions: ["reply", "field"],
  },
  {
    groupKey: "wakeups.create.group_runs",
    conditions: ["run_end", "children"],
  },
  {
    groupKey: "wakeups.create.group_linked",
    conditions: ["pull_request", "other_issue"],
  },
];

/** The i18n id for a condition's name in the picker. Dynamic by construction,
 *  so `locale-completeness.test.ts` cannot see it — the test beside this module
 *  resolves every one instead. */
export function wakeupConditionLabelKey(
  condition: WakeupConditionChoice,
): string {
  return `wakeups.create.cond_${CONDITION_KEY_SUFFIX[condition]}`;
}

/** The one-line explainer under a condition's name. */
export function wakeupConditionHintKey(
  condition: WakeupConditionChoice,
): string {
  return `${wakeupConditionLabelKey(condition)}_hint`;
}

/** The i18n id to show for a draft that will not build.
 *
 *  Two of the eight codes reuse keys the READ round already shipped
 *  (`wakeups.instructionInvalid`, `wakeups.futureTime`) — the same string
 *  describes the same refusal on the edit path, and a second identical line
 *  would be two keys to keep in step for no gain. The rest are web's
 *  `wakeups.create.*` lines. */
export function wakeupDraftErrorKey(error: WakeupDraftError): string {
  switch (error) {
    case "instruction_invalid":
      return "wakeups.instructionInvalid";
    case "future_time":
      return "wakeups.futureTime";
    default:
      return `wakeups.create.${error}`;
  }
}

/** The form's whole state. One flat object, so `update(patch)` is a spread and
 *  no control can own a hidden field. */
export interface WakeupDraft {
  condition: WakeupConditionChoice | null;
  atPreset: WakeupAtPreset;
  /** A `datetime-local` value ("YYYY-MM-DDTHH:mm"), read in the DEVICE's
   *  timezone — see `parseLocalDateTime`. */
  atCustom: string;
  recurrence: WakeupRecurrence;
  /** A `date` value ("YYYY-MM-DD"); the rule ends at the end of that local
   *  day, not at its midnight. */
  until: string;
  /** Null waits for anyone's reply. */
  replyActor: { type: "member" | "agent"; id: string } | null;
  /** Empty waits for any agent's run. */
  runAgentId: string;
  events: string[];
  field: WakeupField;
  /** Status key, label id or property id, depending on `field`. */
  fieldTarget: string;
  /** Property value; select options store their option id. */
  fieldValue: string;
  assignee: { type: "member" | "agent" | "squad"; id: string } | null;
  /** Null waits for every sub-issue. */
  stage: number | null;
  prEvent: "checks_finished" | "merged";
  otherIssue: { id: string; identifier: string } | null;
  otherState: "done" | "ended" | "in_review";
  maxFires: number;
  agentId: string;
  instruction: string;
  mode: "once" | "continuous";
  waitDays: number;
  onTimeout: "wake" | "end";
  /** IANA zone that gives a daily schedule its meaning. */
  timezone: string;
}

/** Every way a draft can be unsendable. Each maps to one line of copy, and
 *  every code the server can answer a well-formed request with is deliberately
 *  NOT here: those arrive as an alert with the API's own message. */
export type WakeupDraftError =
  | "missing_condition"
  | "missing_value"
  | "missing_issue"
  | "missing_agent"
  | "missing_events"
  | "instruction_invalid"
  | "future_time"
  | "until_future";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** A local calendar day as "YYYY-MM-DD", from the LOCAL components — never
 *  `toISOString().slice(0, 10)`, which reports the UTC day and would shift the
 *  date for anyone east of Greenwich after 16:00. */
export function localDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A local instant as the "YYYY-MM-DDTHH:mm" a `datetime-local` field carries. */
export function localDateTimeInput(date: Date): string {
  return `${localDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * A "YYYY-MM-DD[THH:mm[:ss]]" pair read as LOCAL time, or null when it is not
 * one.
 *
 * Explicit components rather than `new Date(value)`: the spec says a date-time
 * form with no offset is local time, and Node and JSC honour that, but Hermes'
 * parser is narrower and an ISO reading would move the instant by the device's
 * whole UTC offset — a 15:01 wakeup becoming 23:01. Splitting the fields makes
 * the meaning independent of the engine.
 *
 * A value without a time part gets midnight, which is what the `Date` spec
 * does for date-only forms too. Returns null rather than an Invalid Date so the
 * caller's error branch is a `!` check and not a `Number.isFinite` ritual.
 */
export function parseLocalDateTime(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(
    value.trim(),
  );
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const date = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h ?? 0),
    Number(mi ?? 0),
    Number(s ?? 0),
    0,
  );
  return Number.isFinite(date.getTime()) ? date : null;
}

/** A fresh draft: nothing chosen, a week of slack, and a live end date. */
export function emptyWakeupDraft(
  agentId: string,
  timezone: string,
  now = new Date(),
): WakeupDraft {
  const until = new Date(now);
  until.setDate(until.getDate() + 7);
  return {
    condition: null,
    atPreset: "1h",
    atCustom: "",
    recurrence: "daily",
    until: localDate(until),
    replyActor: null,
    runAgentId: "",
    events: [],
    field: "status",
    fieldTarget: "",
    fieldValue: "",
    assignee: null,
    stage: null,
    prEvent: "checks_finished",
    otherIssue: null,
    otherState: "done",
    maxFires: 20,
    agentId,
    instruction: "",
    mode: "once",
    waitDays: 7,
    onTimeout: "wake",
    timezone,
  };
}

/** Conditions that wait for something to happen, which is what gives them a
 *  deadline, a trigger count and a timeout action. `at` and `recurring` are
 *  scheduled instead, and `null` is nothing chosen yet. */
export function isEventCondition(
  condition: WakeupConditionChoice | null,
): condition is Exclude<WakeupConditionChoice, "at" | "recurring"> {
  return !!condition && condition !== "at" && condition !== "recurring";
}

/** A property value typed the way the property stores it.
 *
 *  `checkbox` stores a boolean, `number` a number — but only when the text
 *  actually IS one: a number box someone typed letters into is sent as the
 *  string, which the server rejects against the property's type. Coercing it
 *  (`Number("3a")` → NaN, or an empty string → 0) would send a value the user
 *  never entered and the server would happily store. */
export function propertyConditionValue(
  type: string | undefined,
  raw: string,
): unknown {
  if (type === "checkbox") return raw === "true";
  if (type === "number") {
    const n = Number(raw);
    return raw.trim() !== "" && Number.isFinite(n) ? n : raw;
  }
  return raw;
}

/**
 * The platform-evaluated predicate for a condition choice, if it is one.
 *
 * Four of the nine choices are not events at all — the platform itself checks
 * the field, the sub-issues, the PR or another issue, and the server stores a
 * `condition` instead of `event_types`. `null` means "this choice is not a
 * platform predicate" (reply / run-end / custom / the scheduled pair), NOT
 * "invalid": the caller falls through to building the event list.
 */
export function platformCondition(
  d: WakeupDraft,
  propertyType?: string,
): { condition: WakeupCondition } | { error: WakeupDraftError } | null {
  switch (d.condition) {
    case "field":
      if (d.field === "assignee") {
        return d.assignee
          ? {
              condition: {
                type: "issue_field",
                field: "assignee",
                assignee_type: d.assignee.type,
                assignee_id: d.assignee.id,
              },
            }
          : { error: "missing_value" };
      }
      if (!d.fieldTarget) return { error: "missing_value" };
      if (d.field === "status") {
        return {
          condition: { type: "issue_field", field: "status", value: d.fieldTarget },
        };
      }
      if (d.field === "label") {
        return {
          condition: { type: "issue_field", field: "label", label_id: d.fieldTarget },
        };
      }
      if (!d.fieldValue.trim()) return { error: "missing_value" };
      return {
        condition: {
          type: "issue_field",
          field: "property",
          property_id: d.fieldTarget,
          value: propertyConditionValue(propertyType, d.fieldValue.trim()),
        },
      };
    case "children":
      return {
        condition: d.stage
          ? { type: "children_done", stage: d.stage }
          : { type: "children_done" },
      };
    case "pull_request":
      return { condition: { type: "pull_request", event: d.prEvent } };
    case "other_issue":
      return d.otherIssue
        ? {
            condition: {
              type: "other_issue",
              issue_id: d.otherIssue.id,
              state: d.otherState,
            },
          }
        : { error: "missing_issue" };
    default:
      return null;
  }
}

/**
 * Maps what a person chose onto the wakeup API. The server re-validates
 * everything; this exists so a draft that is obviously unsendable becomes a
 * field error on the form the user is still looking at, instead of a 400 on a
 * sheet that has already closed.
 *
 * `propertyType` is the chosen property's type, needed only because the value
 * has to be typed the way the property stores it.
 */
export function buildWakeupInput(
  d: WakeupDraft,
  now = new Date(),
  propertyType?: string,
): { input: IssueWakeupInput } | { error: WakeupDraftError } {
  if (!d.condition) return { error: "missing_condition" };
  if (!d.agentId) return { error: "missing_agent" };
  const instruction = d.instruction.trim();
  // Bytes, not characters: the server counts `len()` (`issue_wakeup.go:287`)
  // and a Chinese prompt is three bytes a character, so measuring in
  // characters would send it a body it answers 400 to.
  if (!instruction || utf8ByteLength(instruction) > WAKEUP_INSTRUCTION_MAX_BYTES) {
    return { error: "instruction_invalid" };
  }
  const base = { agent_id: d.agentId, instruction };
  switch (d.condition) {
    case "at": {
      let at: Date | null;
      if (d.atPreset === "10m") at = new Date(now.getTime() + 10 * 60_000);
      else if (d.atPreset === "1h") at = new Date(now.getTime() + 60 * 60_000);
      else if (d.atPreset === "tomorrow") {
        at = new Date(now);
        at.setDate(at.getDate() + 1);
        at.setHours(9, 0, 0, 0);
      } else at = parseLocalDateTime(d.atCustom);
      if (!at || !Number.isFinite(at.getTime()) || at.getTime() <= now.getTime()) {
        return { error: "future_time" };
      }
      // No deadline and no on_timeout: the server refuses both on a
      // single-time rule ("a single-time wakeup ends when it fires;
      // it takes no deadline", issue_wakeup.go:78).
      return { input: { ...base, kind: "at", mode: "once", at: at.toISOString() } };
    }
    case "recurring": {
      // The END of the chosen local day, not its midnight — a rule ending at
      // 00:00 would skip the final day the user picked.
      const end = parseLocalDateTime(`${d.until}T23:59:59`);
      if (!end || end.getTime() <= now.getTime()) return { error: "until_future" };
      const schedule: Pick<
        IssueWakeupInput,
        "kind" | "interval_seconds" | "cron_expression" | "timezone"
      > =
        d.recurrence === "hourly"
          ? { kind: "every", interval_seconds: 3600 }
          : {
              kind: "cron",
              cron_expression: d.recurrence === "daily" ? "0 9 * * *" : "0 9 * * 1-5",
              timezone: d.timezone,
            };
      // `expires_at` rather than `expires_in_seconds`: the server refuses the
      // two together (issue_wakeup.go:81), and a repeating rule's end is a
      // date the user picked, not a duration.
      return {
        input: { ...base, ...schedule, mode: "continuous", expires_at: end.toISOString() },
      };
    }
    default: {
      const input: IssueWakeupInput = {
        ...base,
        kind: "event",
        mode: d.mode,
        expires_in_seconds: d.waitDays * 86400,
        on_timeout: d.onTimeout,
      };
      // Only on a repeating rule: `max_fires` on a one-shot is a server 400
      // ("max_fires must be 1–1000 on a repeating rule", issue_wakeup.go:144).
      if (d.mode === "continuous") input.max_fires = d.maxFires;
      const platform = platformCondition(d, propertyType);
      if (platform && "error" in platform) return { error: platform.error };
      if (platform) {
        // A condition and raw events are mutually exclusive server-side
        // ("a condition cannot be combined with events or filters",
        // issue_wakeup.go:154), so the event list is deliberately not set.
        input.condition = platform.condition;
      } else if (d.condition === "reply") {
        input.event_types = ["comment.created"];
        if (d.replyActor) {
          input.filter_actor_type = d.replyActor.type;
          input.filter_actor_id = d.replyActor.id;
        }
      } else if (d.condition === "run_end") {
        input.event_types = [...RUN_END_EVENTS];
        if (d.runAgentId) input.filter_agent_id = d.runAgentId;
      } else {
        if (d.events.length === 0) return { error: "missing_events" };
        input.event_types = d.events;
      }
      return { input };
    }
  }
}
