// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { IssueWakeupInput } from "@multica/core/types";
import {
  WAKEUP_CONDITION_GROUPS,
  WAKEUP_EVENT_TYPES,
  WAKEUP_MAX_FIRES,
  WAKEUP_WAIT_DAYS,
  buildWakeupInput,
  emptyWakeupDraft,
  isEventCondition,
  platformCondition,
  propertyConditionValue,
  wakesAssigneeOnComments,
  wakeupConditionHintKey,
  wakeupConditionLabelKey,
  wakeupDraftErrorKey,
  type WakeupConditionChoice,
  type WakeupDraft,
  type WakeupDraftError,
} from "./wakeup-draft";
import { utf8ByteLength } from "./wakeup-controls";

/** The shape `buildWakeupInput` returns, named so the helpers below can be
 *  typed without restating the union. */
type BuildResult = ReturnType<typeof buildWakeupInput>;

/**
 * Iteration 216 (MYS-2040) — the decisions behind the wakeup CREATE form.
 *
 * This module is the round's must-agree point with web: the same draft has to
 * produce the same `IssueWakeupInput`, or the same error code, on both
 * clients. Web's own suite (`packages/views/issues/components/wakeup-draft
 * .test.ts`) is the source of the expectations below; each case that web pins
 * is pinned here too, so a future port that drifts is caught by the same
 * assertions rather than by a user reading a 400.
 *
 * The one deliberate divergence: instruction length is measured in BYTES. Web
 * uses `new TextEncoder().encode(...).length`, the server counts `len()` (also
 * bytes), and `String.length` would let a Chinese prompt of 4,001 characters —
 * 12,003 bytes — through a client check and into a server 400. That case is
 * asserted directly below.
 */

const now = new Date(2026, 8, 24, 15, 0, 0);
const draft = (patch: Partial<WakeupDraft>): WakeupDraft => ({
  ...emptyWakeupDraft("agent", "Asia/Shanghai", now),
  instruction: "Check the result",
  ...patch,
});

/** The input a successful build produced. Kept typed as `IssueWakeupInput` so
 *  the `absent field` assertions below (`.toBeUndefined()` on `expires_at`,
 *  `on_timeout`, `filter_actor_type`, …) are checked against the real shape
 *  rather than against `{}` — an untyped empty object makes every one of them
 *  compile and pass even if the field name is wrong. */
function inputOf(result: BuildResult): IssueWakeupInput {
  if (!("input" in result)) {
    throw new Error(`expected an input, got the error ${result.error}`);
  }
  return result.input;
}

describe("emptyWakeupDraft", () => {
  it("starts on no condition, with a week of slack and a live deadline", () => {
    const d = emptyWakeupDraft("a-1", "Asia/Shanghai", now);
    expect(d.condition).toBeNull();
    expect(d.agentId).toBe("a-1");
    expect(d.timezone).toBe("Asia/Shanghai");
    expect(d.mode).toBe("once");
    expect(d.maxFires).toBe(20);
    expect(d.waitDays).toBe(7);
    // A blank end date is a guaranteed `until_future`; seeding one a week out
    // means a recurring rule the user never touches still submits.
    expect(d.until).toBe("2026-10-01");
  });
});

describe("the event catalog", () => {
  it("carries all 25 issue-scoped events, in web's order", () => {
    // The order is web's catalog order and the custom-condition picker renders
    // the list verbatim, so a reorder is a visible divergence.
    expect(WAKEUP_EVENT_TYPES.length).toBe(25);
    expect(WAKEUP_EVENT_TYPES[0]).toBe("task.queued");
    expect(WAKEUP_EVENT_TYPES[WAKEUP_EVENT_TYPES.length - 1]).toBe(
      "attachment.detached",
    );
    expect(new Set(WAKEUP_EVENT_TYPES).size).toBe(25);
  });

  it("offers web's wait and fire-count ladders", () => {
    expect([...WAKEUP_WAIT_DAYS]).toEqual([1, 3, 7, 30]);
    expect([...WAKEUP_MAX_FIRES]).toEqual([5, 10, 20, 50]);
  });

  it("separates the conditions that wait for an event from the scheduled ones", () => {
    expect(isEventCondition("at")).toBe(false);
    expect(isEventCondition("recurring")).toBe(false);
    expect(isEventCondition(null)).toBe(false);
    for (const c of [
      "reply",
      "field",
      "run_end",
      "children",
      "pull_request",
      "other_issue",
      "custom",
    ] as const) {
      expect(isEventCondition(c)).toBe(true);
    }
  });
});

describe("buildWakeupInput: the three gates every condition shares", () => {
  it("refuses a draft with no condition", () => {
    expect(buildWakeupInput(draft({}), now)).toEqual({
      error: "missing_condition",
    });
  });

  it("refuses a draft with no agent to wake", () => {
    expect(buildWakeupInput(draft({ condition: "at", agentId: "" }), now)).toEqual(
      { error: "missing_agent" },
    );
  });

  it("refuses an empty instruction", () => {
    // The server trims and then refuses an empty body, so sending one is a
    // guaranteed 400 rather than a way to clear the field.
    expect(
      buildWakeupInput(draft({ condition: "at", instruction: "  " }), now),
    ).toEqual({ error: "instruction_invalid" });
  });

  it("measures the instruction in UTF-8 bytes, not characters", () => {
    // The defect this pins: 4001 Chinese characters is 12003 bytes, so
    // `String.length` (4001) would pass and the server would answer 400.
    const chinese = "字".repeat(4001);
    expect(chinese.length).toBe(4001);
    expect(utf8ByteLength(chinese)).toBe(12003);
    expect(
      buildWakeupInput(draft({ condition: "at", instruction: chinese }), now),
    ).toEqual({ error: "instruction_invalid" });

    // And the boundary itself is inclusive: exactly 12000 bytes is accepted.
    const atLimit = "字".repeat(4000);
    expect(utf8ByteLength(atLimit)).toBe(12000);
    expect(
      buildWakeupInput(draft({ condition: "at", instruction: atLimit }), now),
    ).toMatchObject({ input: { instruction: atLimit } });
  });

  it("trims the instruction before sending it", () => {
    expect(
      buildWakeupInput(draft({ condition: "at", instruction: "  go  " }), now),
    ).toMatchObject({ input: { instruction: "go" } });
  });
});

describe("buildWakeupInput: 'at' — a single time", () => {
  it("schedules the 10-minute and 1-hour presets off `now`", () => {
    expect(buildWakeupInput(draft({ condition: "at", atPreset: "10m" }), now)).toEqual({
      input: {
        agent_id: "agent",
        instruction: "Check the result",
        kind: "at",
        mode: "once",
        at: new Date(2026, 8, 24, 15, 10).toISOString(),
      },
    });
    expect(buildWakeupInput(draft({ condition: "at", atPreset: "1h" }), now)).toMatchObject({
      input: { at: new Date(2026, 8, 24, 16, 0).toISOString() },
    });
  });

  it("puts 'tomorrow' at 09:00 LOCAL, not UTC", () => {
    // Building this from an ISO string would read as UTC and move the wakeup
    // by the viewer's offset — the same class of bug `rescheduleInstant`
    // documents on the write side.
    expect(
      buildWakeupInput(draft({ condition: "at", atPreset: "tomorrow" }), now),
    ).toMatchObject({ input: { at: new Date(2026, 8, 25, 9, 0, 0, 0).toISOString() } });
  });

  it("never sends a deadline, an interval or a timeout on an `at` rule", () => {
    // The server refuses every one of them: "a single-time wakeup ends when
    // it fires; it takes no deadline" (issue_wakeup.go:78).
    const result = buildWakeupInput(
      draft({ condition: "at", atPreset: "1h", onTimeout: "wake", waitDays: 30 }),
      now,
    );
    expect("input" in result && result.input).toMatchObject({ kind: "at" });
    const input = inputOf(result);
    expect(input.expires_at).toBeUndefined();
    expect(input.expires_in_seconds).toBeUndefined();
    expect(input.on_timeout).toBeUndefined();
  });

  it("refuses a custom time that is in the past, malformed, or empty", () => {
    const custom = (atCustom: string) =>
      buildWakeupInput(draft({ condition: "at", atPreset: "custom", atCustom }), now);
    // Past.
    expect(custom("2026-09-24T14:00")).toEqual({ error: "future_time" });
    // Empty.
    expect(custom("")).toEqual({ error: "future_time" });
    // Malformed.
    expect(custom("not a date")).toEqual({ error: "future_time" });
    // Exactly `now` is refused too — the server wants strictly future.
    expect(custom("2026-09-24T15:00")).toEqual({ error: "future_time" });
    // A minute later is accepted.
    expect(custom("2026-09-24T15:01")).toMatchObject({ input: { kind: "at" } });
  });
});

describe("buildWakeupInput: 'recurring' — a schedule with an end date", () => {
  it("ends the rule at the end of the chosen local day", () => {
    // 23:59:59 local, not midnight: a rule that ended at 00:00 would skip the
    // final day the user picked.
    expect(
      buildWakeupInput(draft({ condition: "recurring", recurrence: "daily", until: "2026-09-30" }), now),
    ).toEqual({
      input: {
        agent_id: "agent",
        instruction: "Check the result",
        kind: "cron",
        cron_expression: "0 9 * * *",
        timezone: "Asia/Shanghai",
        mode: "continuous",
        expires_at: new Date(2026, 8, 30, 23, 59, 59).toISOString(),
      },
    });
  });

  it("maps the three recurrence choices to their schedules", () => {
    const at = (recurrence: WakeupDraft["recurrence"]) =>
      buildWakeupInput(draft({ condition: "recurring", recurrence, until: "2026-09-30" }), now);
    expect(at("hourly")).toMatchObject({
      input: { kind: "every", interval_seconds: 3600 },
    });
    expect(at("daily")).toMatchObject({ input: { cron_expression: "0 9 * * *" } });
    expect(at("weekdays")).toMatchObject({ input: { cron_expression: "0 9 * * 1-5" } });
  });

  it("carries no on_timeout and no expires_in_seconds", () => {
    // An hourly rule takes an absolute end, not a relative wait, and the
    // server refuses `expires_at` and `expires_in_seconds` together
    // (issue_wakeup.go:81).
    const result = buildWakeupInput(
      draft({ condition: "recurring", recurrence: "daily", until: "2026-09-30" }),
      now,
    );
    const input = inputOf(result);
    expect(input.expires_in_seconds).toBeUndefined();
    expect(input.on_timeout).toBeUndefined();
  });

  it("refuses an end date that is not after now", () => {
    const until = (d: string) =>
      buildWakeupInput(draft({ condition: "recurring", until: d }), now);
    // Yesterday.
    expect(until("2026-09-23")).toEqual({ error: "until_future" });
    // Today: `T23:59:59` is still ahead of 15:00, so today is ACCEPTED —
    // matching web, whose check is on the resulting instant and not the day.
    expect(until("2026-09-24")).toMatchObject({ input: { kind: "cron" } });
    // Unparseable and empty.
    expect(until("")).toEqual({ error: "until_future" });
    expect(until("nonsense")).toEqual({ error: "until_future" });
  });
});

describe("buildWakeupInput: the event conditions", () => {
  it("waits for a reply, optionally from one actor", () => {
    expect(
      buildWakeupInput(
        draft({ condition: "reply", replyActor: { type: "member", id: "user" }, waitDays: 3 }),
        now,
      ),
    ).toEqual({
      input: {
        agent_id: "agent",
        instruction: "Check the result",
        kind: "event",
        mode: "once",
        expires_in_seconds: 259200,
        on_timeout: "wake",
        event_types: ["comment.created"],
        filter_actor_type: "member",
        filter_actor_id: "user",
      },
    });
  });

  it("sends no actor filter when the reply may come from anyone", () => {
    const result = buildWakeupInput(draft({ condition: "reply" }), now);
    expect(result).toMatchObject({ input: { event_types: ["comment.created"] } });
    const input = inputOf(result);
    expect(input.filter_actor_type).toBeUndefined();
    expect(input.filter_actor_id).toBeUndefined();
  });

  it("waits for any run to end, or one agent's", () => {
    expect(buildWakeupInput(draft({ condition: "run_end" }), now)).toMatchObject({
      input: { event_types: ["task.completed", "task.failed", "task.cancelled"] },
    });
    expect(
      buildWakeupInput(draft({ condition: "run_end", runAgentId: "emacs" }), now),
    ).toMatchObject({
      input: {
        event_types: ["task.completed", "task.failed", "task.cancelled"],
        filter_agent_id: "emacs",
      },
    });
  });

  it("refuses a custom rule with no events chosen", () => {
    expect(buildWakeupInput(draft({ condition: "custom" }), now)).toEqual({
      error: "missing_events",
    });
  });

  it("sends the chosen custom events", () => {
    expect(
      buildWakeupInput(
        draft({ condition: "custom", events: ["issue.labels_changed", "reaction.added"] }),
        now,
      ),
    ).toMatchObject({
      input: { event_types: ["issue.labels_changed", "reaction.added"] },
    });
  });
});

describe("buildWakeupInput: the repeating knobs", () => {
  it("caps a repeating wait and leaves a single one uncapped", () => {
    // The server refuses `max_fires` on a one-shot outright ("max_fires must
    // be 1–1000 on a repeating rule", issue_wakeup.go:144), so sending it
    // unconditionally would make every `once` rule a 400.
    expect(
      buildWakeupInput(draft({ condition: "reply", mode: "continuous", maxFires: 10 }), now),
    ).toMatchObject({ input: { mode: "continuous", max_fires: 10 } });
    const once = buildWakeupInput(draft({ condition: "reply" }), now);
    expect("input" in once && once.input.max_fires).toBeUndefined();
  });

  it("sends the timeout action and a relative deadline in seconds", () => {
    const input = (waitDays: number, onTimeout: WakeupDraft["onTimeout"]) => {
      const result = buildWakeupInput(
        draft({ condition: "reply", waitDays, onTimeout }),
        now,
      );
      return inputOf(result);
    };
    expect(input(1, "end")).toMatchObject({
      expires_in_seconds: 86400,
      on_timeout: "end",
    });
    // Every rung of the ladder stays inside the server's 60s..1y window.
    for (const days of WAKEUP_WAIT_DAYS) {
      const seconds = input(days, "wake").expires_in_seconds ?? 0;
      expect(seconds).toBeGreaterThanOrEqual(60);
      expect(seconds).toBeLessThanOrEqual(31_536_000);
    }
  });
});

describe("platformCondition", () => {
  const input = (patch: Partial<WakeupDraft>, propertyType?: string) =>
    buildWakeupInput(draft(patch), now, propertyType);

  it("turns each field choice into the predicate the platform evaluates", () => {
    expect(input({ condition: "field", field: "status", fieldTarget: "in_review" })).toMatchObject({
      input: {
        kind: "event",
        mode: "once",
        condition: { type: "issue_field", field: "status", value: "in_review" },
        expires_in_seconds: 604800,
      },
    });
    expect(input({ condition: "field", field: "label", fieldTarget: "lbl" })).toMatchObject({
      input: { condition: { type: "issue_field", field: "label", label_id: "lbl" } },
    });
    expect(
      input({ condition: "field", field: "assignee", assignee: { type: "squad", id: "sq" } }),
    ).toMatchObject({
      input: {
        condition: {
          type: "issue_field",
          field: "assignee",
          assignee_type: "squad",
          assignee_id: "sq",
        },
      },
    });
    expect(
      input({
        condition: "field",
        field: "property",
        fieldTarget: "p",
        fieldValue: "opt-1",
      }, "select"),
    ).toMatchObject({
      input: { condition: { type: "issue_field", field: "property", property_id: "p", value: "opt-1" } },
    });
  });

  it("turns the structural choices into their predicates", () => {
    expect(input({ condition: "children", stage: 2 })).toMatchObject({
      input: { condition: { type: "children_done", stage: 2 } },
    });
    expect(input({ condition: "children", stage: null })).toMatchObject({
      input: { condition: { type: "children_done" } },
    });
    expect(input({ condition: "pull_request", prEvent: "merged" })).toMatchObject({
      input: { condition: { type: "pull_request", event: "merged" } },
    });
    expect(
      input({
        condition: "other_issue",
        otherIssue: { id: "i2", identifier: "MUL-2" },
        otherState: "ended",
      }),
    ).toMatchObject({
      input: { condition: { type: "other_issue", issue_id: "i2", state: "ended" } },
    });
  });

  it("never sends raw events alongside a condition", () => {
    // The server refuses the combination ("a condition cannot be combined with
    // events or filters", issue_wakeup.go:154).
    for (const patch of [
      { condition: "field", field: "status", fieldTarget: "done" },
      { condition: "children" },
      { condition: "pull_request" },
      { condition: "other_issue", otherIssue: { id: "i2", identifier: "MUL-2" } },
    ] as Partial<WakeupDraft>[]) {
      const result = input(patch);
      expect("input" in result && result.input.event_types).toBeUndefined();
    }
  });

  it("asks for the missing value or issue instead of sending a partial rule", () => {
    expect(input({ condition: "field", field: "status" })).toEqual({ error: "missing_value" });
    expect(input({ condition: "field", field: "label" })).toEqual({ error: "missing_value" });
    expect(input({ condition: "field", field: "assignee" })).toEqual({ error: "missing_value" });
    expect(
      input({ condition: "field", field: "property", fieldTarget: "p", fieldValue: "  " }),
    ).toEqual({ error: "missing_value" });
    // A property with no property chosen at all is missing a value too.
    expect(input({ condition: "field", field: "property", fieldTarget: "" })).toEqual({
      error: "missing_value",
    });
    expect(input({ condition: "other_issue" })).toEqual({ error: "missing_issue" });
  });

  it("returns null for a draft whose condition is not a platform predicate", () => {
    expect(platformCondition(draft({ condition: "reply" }))).toBeNull();
    expect(platformCondition(draft({ condition: "at" }))).toBeNull();
    expect(platformCondition(draft({ condition: null }))).toBeNull();
  });
});

describe("propertyConditionValue", () => {
  it("types a value the way the property stores it", () => {
    expect(propertyConditionValue("checkbox", "true")).toBe(true);
    expect(propertyConditionValue("checkbox", "false")).toBe(false);
    expect(propertyConditionValue("number", "3")).toBe(3);
    // A number box the user typed letters into is sent as text rather than as
    // NaN — the server validates the value against the property's type, and an
    // empty string must not become 0.
    expect(propertyConditionValue("number", "3a")).toBe("3a");
    expect(propertyConditionValue("number", "  ")).toBe("  ");
    expect(propertyConditionValue("select", "opt-1")).toBe("opt-1");
    expect(propertyConditionValue(undefined, "raw")).toBe("raw");
  });
});

describe("wakesAssigneeOnComments", () => {
  // The platform already runs the agent assignee on a member's comment; a rule
  // that asks for the same thing joins that run instead of starting a second.
  // The form shows a hint when this is true, so a wrong answer is a wrong
  // thing on screen — not just a cosmetic one.
  it("flags a reply rule that the assignee's own runs already cover", () => {
    const reply = draft({ condition: "reply", agentId: "agent" });
    expect(wakesAssigneeOnComments(reply, "agent")).toBe(true);
    expect(
      wakesAssigneeOnComments({ ...reply, replyActor: { type: "member", id: "u" } }, "agent"),
    ).toBe(true);
  });

  it("does not flag a reply rule that only an agent's comments would fire", () => {
    // Agents' comments do not start the assignee's runs, so this really is a
    // separate rule.
    expect(
      wakesAssigneeOnComments(
        { ...draft({ condition: "reply", agentId: "agent" }), replyActor: { type: "agent", id: "a" } },
        "agent",
      ),
    ).toBe(false);
  });

  it("flags a custom rule watching comment.created, and nothing else", () => {
    expect(
      wakesAssigneeOnComments(
        draft({ condition: "custom", agentId: "agent", events: ["comment.created"] }),
        "agent",
      ),
    ).toBe(true);
    expect(
      wakesAssigneeOnComments(
        draft({ condition: "custom", agentId: "agent", events: ["issue.status_changed"] }),
        "agent",
      ),
    ).toBe(false);
  });

  it("stays false when the rule wakes someone other than the assignee", () => {
    const reply = draft({ condition: "reply", agentId: "agent" });
    expect(wakesAssigneeOnComments(reply, "someone-else")).toBe(false);
    expect(wakesAssigneeOnComments(reply, null)).toBe(false);
  });
});

/**
 * Every key the create form derives at runtime must resolve in both bundles.
 *
 * `locale-completeness.test.ts` only sees plain string literals passed to
 * `t(...)`, and the create form's condition labels, hints, group headings and
 * error lines are all built by template (`wakeups.create.cond_${suffix}`), so
 * that guard cannot reach them. Without this suite a typo in the suffix map
 * would render the raw key — `wakeups.create.cond_pr` — inside a picker row,
 * which no build step and no other test would catch.
 */
describe("the create form's derived i18n keys", () => {
  const bundles = Object.fromEntries(
    (["en", "zh"] as const).map((locale) => [
      locale,
      JSON.parse(
        readFileSync(
          path.resolve(__dirname, `i18n/locales/${locale}.json`),
          "utf8",
        ),
      ) as Record<string, string>,
    ]),
  );

  /** The eight GROUPED choices. `custom` is deliberately not here: web renders
   *  it alone below a separator, because it is the escape hatch rather than a
   *  member of any family. The form appends it the same way, so the derived-key
   *  assertions below add it separately. */
  const GROUPED = WAKEUP_CONDITION_GROUPS.flatMap((g) => g.conditions);
  const CONDITIONS = [...GROUPED, "custom"] as WakeupConditionChoice[];

  it("groups eight choices in four families and keeps `custom` outside them", () => {
    // A choice dropped from the table is a condition the form cannot offer at
    // all; a duplicate would render twice; and `custom` appearing in a group
    // would put the escape hatch inside a family it does not belong to.
    expect(WAKEUP_CONDITION_GROUPS.map((g) => g.conditions.length)).toEqual([
      2, 2, 2, 2,
    ]);
    expect(GROUPED).not.toContain("custom");
    expect([...CONDITIONS].sort()).toEqual(
      [
        "at",
        "children",
        "custom",
        "field",
        "other_issue",
        "pull_request",
        "recurring",
        "reply",
        "run_end",
      ].sort(),
    );
    expect(new Set(CONDITIONS).size).toBe(9);
  });

  it("resolves every condition label, hint and group heading in both bundles", () => {
    const keys = [
      ...CONDITIONS.map((c) => wakeupConditionLabelKey(c)),
      ...CONDITIONS.map((c) => wakeupConditionHintKey(c)),
      ...WAKEUP_CONDITION_GROUPS.map((g) => g.groupKey),
    ];
    for (const locale of ["en", "zh"] as const) {
      const blank = keys.filter(
        (key) => !bundles[locale][key] || bundles[locale][key].trim() === "",
      );
      expect(blank, `${locale} is missing copy for`).toEqual([]);
    }
  });

  it("resolves every draft error's line in both bundles", () => {
    const errors: WakeupDraftError[] = [
      "missing_condition",
      "missing_value",
      "missing_issue",
      "missing_agent",
      "missing_events",
      "instruction_invalid",
      "future_time",
      "until_future",
    ];
    for (const locale of ["en", "zh"] as const) {
      const blank = errors
        .map(wakeupDraftErrorKey)
        .filter((key) => !bundles[locale][key]);
      expect(blank, `${locale} is missing copy for`).toEqual([]);
    }
  });

  it("keeps the two error codes that reuse read-round keys pointed at them", () => {
    // Not cosmetic: `wakeups.instructionInvalid` and `wakeups.futureTime`
    // already existed, and web reuses them. A template-built
    // `wakeups.create.instruction_invalid` would be a key nobody has.
    expect(wakeupDraftErrorKey("instruction_invalid")).toBe(
      "wakeups.instructionInvalid",
    );
    expect(wakeupDraftErrorKey("future_time")).toBe("wakeups.futureTime");
    for (const key of [
      wakeupDraftErrorKey("instruction_invalid"),
      wakeupDraftErrorKey("future_time"),
    ]) {
      expect(bundles.en[key]).toBeTruthy();
      expect(bundles.zh[key]).toBeTruthy();
    }
  });
});
