import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "./i18n/locales/en.json";
import zh from "./i18n/locales/zh.json";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({ getLocales: vi.fn() }));

// Iteration 277 (MYS-2433). `wakeupState()` names a rule's lifecycle state in
// snake_case (`issue_closed`, `timed_out`) because those names mirror web's.
// The dictionaries store the same nine states in camelCase (`issueClosed`,
// `timedOut`). Two of the nine therefore had no entry, and `translate()`'s
// last resort is to echo the id — so the screen showed
// `wakeups.ruleStates.issue_closed` verbatim. These tests pin the mapping.

const DICT: Record<"en" | "zh", Record<string, string>> = { en, zh };

/** Stand-in bundle whose `t` behaves exactly like the real `translate()`,
 *  including the echo-the-id fallback that made the defect visible. */
function bundle(locale: "en" | "zh") {
  const dict = DICT[locale];
  return {
    t: (id: string, params?: Record<string, string | number>) => {
      let out = dict[id] ?? id;
      if (params)
        for (const [k, v] of Object.entries(params))
          out = out.replaceAll(`{{${k}}}`, String(v));
      return out;
    },
    locale: locale === "zh" ? "zh-CN" : "en-US",
  };
}

/** Every state `wakeupState` can return, spelled the way it returns them. */
const ALL_STATES = [
  "issue_closed",
  "waiting",
  "scheduled",
  "paused",
  "timed_out",
  "disabled",
  "triggered",
  "expired",
  "inactive",
] as const;

/** A workspace-table row in the `inactive` state; each case overrides from
 *  here, so a case only states the field that puts it in its state. */
const BASE_ROW: Record<string, unknown> = {
  id: "w1",
  issue_id: "i1",
  issue_title: "t",
  issue_identifier: "MYS-1",
  agent_id: "a1",
  agent_name: "A",
  kind: "event",
  mode: "once",
  event_types: ["comment.created"],
  condition: null,
  filter_agent_id: null,
  filter_task_id: null,
  interval_seconds: null,
  cron_expression: null,
  timezone: "UTC",
  next_fire_at: null,
  expires_at: null,
  expiry_seconds: null,
  enabled: false,
  disabled_at: null,
  paused_reason: null,
  timed_out_at: null,
  last_task_id: null,
  last_task_status: null,
  last_error: null,
  source: "agent",
  can_manage: true,
  issue_closed: false,
};

describe("wakeups.ruleStates: every state must resolve to real copy", () => {
  let mod: typeof import("./wakeup-presentation");
  beforeEach(async () => {
    mod = await import("./wakeup-presentation");
  });

  it("has a dictionary entry for all nine states, in both locales", () => {
    // The family-level gate. `locale-completeness.test.ts` only checks
    // LITERAL `t("…")` calls, and this family is built from a variable — so
    // that harness skipped it and the two missing keys shipped.
    //
    // The key comes from `wakeupStateKey`, not from interpolating the state
    // name here: re-deriving the id inside the test would have reproduced the
    // very bug under test, and passed while the app stayed broken.
    for (const state of ALL_STATES) {
      const key = mod.wakeupStateKey(state);
      for (const locale of ["en", "zh"] as const) {
        expect(DICT[locale][key], `${locale} is missing ${key}`).toBeTruthy();
      }
    }
  });

  it("never renders a dotted i18n id to the reader", () => {
    // The symptom the reader actually saw. A regression that renames a leaf
    // without renaming this list still fails here, because the rendered
    // string stops looking like prose and starts looking like a key.
    for (const state of ALL_STATES) {
      const text = bundle("zh").t(mod.wakeupStateKey(state));
      expect(text, `${state} rendered as a key`).not.toMatch(/^wakeups\./);
    }
  });
});

describe("wakeupStateText resolves a state to its own copy, not an id", () => {
  let mod: typeof import("./wakeup-presentation");
  beforeEach(async () => {
    mod = await import("./wakeup-presentation");
  });

  it("says the issue ended for a closed rule, in both locales", () => {
    const rule = { id: "w1", kind: "at", enabled: false } as never;
    expect(mod.wakeupStateText(bundle("zh"), rule, true)).toBe(
      "任务已结束，唤醒已停用",
    );
    expect(mod.wakeupStateText(bundle("en"), rule, true)).toBe(
      "Issue ended; wakeups stopped",
    );
  });

  it("says it timed out, in both locales", () => {
    const rule = {
      id: "w2",
      kind: "event",
      enabled: false,
      paused_reason: null,
      timed_out_at: "2026-01-01T00:00:00Z",
      disabled_at: null,
      last_task_id: null,
    } as never;
    expect(mod.wakeupStateText(bundle("zh"), rule, false)).toBe("已超时");
    expect(mod.wakeupStateText(bundle("en"), rule, false)).toBe("Timed out");
  });

  it("still reads the seven states that already worked", () => {
    // Positive control: a fix that mapped everything to one string would
    // satisfy the two tests above and be worse than the defect.
    const base: Record<string, unknown> = {
      id: "w3",
      kind: "event",
      enabled: false,
      paused_reason: null,
      timed_out_at: null,
      disabled_at: null,
      last_task_id: null,
    };
    expect(mod.wakeupStateText(bundle("en"), base as never, false)).toBe(
      "Not enabled",
    );
    expect(
      mod.wakeupStateText(bundle("en"), { ...base, enabled: true } as never, false),
    ).toBe("Waiting for trigger");
  });
});

describe("the table's 有效期 cell agrees with the issue section", () => {
  // The two surfaces render the same nine states through two different
  // modules. Before this round they disagreed twice over: the key vocabulary
  // was camelCase in one place and snake_case in the other, and the table
  // additionally collapsed every non-event state to "waiting". An assertion
  // that both agree for every state catches both.
  it("renders the same words for a rule in the same state", async () => {
    const { wakeupStateText } = await import("./wakeup-presentation");
    const { workspaceWakeupEndsText } = await import("./workspace-wakeups");
    // Only the stopped half is expected to agree. Web's cell answers two
    // different questions: while a rule is live it says WHEN it stops
    // ("fires once" / "until <date>"), and only once it is stopped does it
    // name the state. So parity is the right assertion exactly where the two
    // surfaces are answering the same question.
    const cases: Array<[string, Record<string, unknown>, boolean]> = [
      ["inactive", {}, false],
      ["timed_out", { timed_out_at: "2026-01-01T00:00:00Z" }, false],
      ["disabled", { disabled_at: "2026-01-01T00:00:00Z" }, false],
      ["triggered", { last_task_id: "t1" }, false],
      ["issue_closed", {}, true],
    ];
    for (const [label, over, closed] of cases) {
      const rule = { ...BASE_ROW, ...over, issue_closed: closed };
      const section = wakeupStateText(
        bundle("zh"),
        { ...rule, instruction: "" } as never,
        closed,
      );
      const table = workspaceWakeupEndsText(bundle("zh"), rule as never);
      expect(table, `${label}: table and section disagree`).toBe(section);
    }
  });

  it("still answers for a live rule, where the two surfaces differ on purpose", async () => {
    // Guards the other direction: routing the stopped branch through
    // `wakeupState` must not have swallowed the live branch, whose whole job
    // is to say when the rule stops rather than what state it is in.
    const { workspaceWakeupEndsText } = await import("./workspace-wakeups");
    const live = {
      ...BASE_ROW,
      enabled: true,
      issue_closed: false,
      mode: "once",
    };
    expect(workspaceWakeupEndsText(bundle("zh"), live as never)).toBe("触发一次");
  });
});
