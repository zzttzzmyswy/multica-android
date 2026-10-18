import { describe, expect, it, vi } from "vitest";
import type { WakeupCondition, WakeupPreview } from "@multica/core/types";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

/**
 * Iteration 257 (MYS-2228): a name embedded in a SENTENCE obeys a different
 * rule from a name that is its own text node.
 *
 * Iterations 254–256 wired cells, lines and property rows, where an unread
 * directory could simply contribute nothing (or a skeleton) and the surface
 * around it stayed readable. A wakeup condition sentence has no such room: the
 * name is an argument inside `t("wakeups.cond.assignee", { name })`, so
 * withholding it yields 「当此任务指派给 时」 — a template with its argument
 * missing, which reads as a rendering fault.
 *
 * So the DECISION moves from "what string do I have" to "what may I say", and
 * the fallback is at the SENTENCE level. This file locks:
 *
 *   - the assertion voice (a rule read back from the server) retreating to a
 *     sentence that names nobody;
 *   - the echo voice (a value the user just chose) keeping the sentence whole
 *     with the type's noun;
 *   - both voices agreeing once the directory answers;
 *   - the fallback NOT being `wakeups.conditions.assigneeChanged`, which is a
 *     broader rule than the one stored.
 */

const EN: Record<string, string> = {
  "wakeups.cond.assignee": "When this issue is assigned to {{name}}",
  "wakeups.cond.assigneeUnread": "When this issue is assigned to someone",
  "wakeups.wait.assignee": "Waiting for {{name}} to be assigned",
  "wakeups.wait.assigneeUnread": "Waiting for this issue to be assigned",
  "wakeups.conditions.assigneeChanged": "When this issue's assignee changes",
};

/** A `t` that interpolates `{{param}}`, so a sentence with a hole is visible
 *  as a sentence with a hole rather than as a template string. */
const t = (id: string, params?: Record<string, string | number>): string => {
  const template = EN[id] ?? id;
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    String(params[key] ?? ""),
  );
};

const ASSIGNEE_CONDITION: WakeupCondition = {
  type: "issue_field",
  field: "assignee",
  assignee_type: "agent",
  assignee_id: "agent-1",
};

function preview(condition: WakeupCondition = ASSIGNEE_CONDITION): WakeupPreview {
  return {
    id: "w1",
    issue_id: "i1",
    agent_id: "a1",
    agent_name: "Agent One",
    kind: "event",
    mode: "once",
    event_types: [],
    filter_task_id: null,
    filter_agent_name: null,
    filter_actor_type: null,
    filter_actor_id: null,
    filter_actor_name: null,
    interval_seconds: null,
    cron_expression: null,
    timezone: "UTC",
    next_fire_at: null,
    condition,
  } as WakeupPreview;
}

async function load() {
  return await import("./wakeup-presentation");
}

const settled = { kind: "name", name: "Ada Lovelace" } as const;
const unsettled = { kind: "unsettled" } as const;

describe("a condition sentence whose name the client may not state", () => {
  it("retreats the WHOLE sentence in the assertion voice", async () => {
    const mod = await load();
    const text = mod.wakeupTrigger(
      { t, actorName: () => unsettled },
      preview(),
    );
    expect(text).toBe("When this issue is assigned to someone");
  });

  it("does the same for the header chip's waiting voice", async () => {
    const mod = await load();
    const text = mod.wakeupWaitingText(
      { t, actorName: () => unsettled },
      preview(),
    );
    expect(text).toBe("Waiting for this issue to be assigned");
  });

  it("never leaves the template's argument slot empty", async () => {
    // The failure mode withholding a NAME would produce. Asserted directly
    // because it is the whole reason the fallback is at sentence level.
    const mod = await load();
    const cond = mod.wakeupTrigger({ t, actorName: () => unsettled }, preview());
    const wait = mod.wakeupWaitingText(
      { t, actorName: () => unsettled },
      preview(),
    );
    expect(cond).not.toMatch(/assigned to\s*$/);
    expect(wait).not.toMatch(/Waiting for\s+to be assigned/);
  });

  it("does not reach for the assigneeChanged sentence", async () => {
    // 「当此任务的负责人变化时」 describes ANY assignee change; the stored rule
    // fires only when the field becomes ONE named actor. Trading an unbacked
    // name for an over-broad rule is a second, worse claim.
    const mod = await load();
    const text = mod.wakeupTrigger({ t, actorName: () => unsettled }, preview());
    expect(text).not.toBe(EN["wakeups.conditions.assigneeChanged"]);
  });

  it("names the actor again the moment the directory answers", async () => {
    const mod = await load();
    const text = mod.wakeupTrigger(
      { t, actorName: () => settled },
      preview(),
    );
    expect(text).toBe("When this issue is assigned to Ada Lovelace");
  });

  it("states a settled-but-gone actor's id fragment rather than retreating", async () => {
    // `gone` is a MEASUREMENT ("the directory answered and does not hold this
    // row"), so the sentence keeps its shape and names which one is gone —
    // the same call `actorNameState`'s `gone` branch makes for a whole cell.
    const mod = await load();
    const text = mod.wakeupTrigger(
      { t, actorName: () => ({ kind: "gone", name: "agent-1" }) },
      preview(),
    );
    expect(text).toBe("When this issue is assigned to agent-1");
    expect(text).not.toContain("someone");
  });

  it("falls back to the raw id when no resolver is supplied at all", async () => {
    // The pre-257 behaviour, kept for callers that have no lookup (a stored
    // preview rendered outside the workspace scope).
    const mod = await load();
    expect(mod.wakeupTrigger({ t }, preview())).toBe(
      "When this issue is assigned to agent-1",
    );
  });
});

describe("a condition sentence echoing a value the user just chose", () => {
  it("keeps the sentence whole and degrades to the type's noun", async () => {
    const mod = await load();
    const text = mod.wakeupTrigger(
      { t, actorName: () => unsettled, actorNameContext: "echo" },
      preview(),
    );
    // Not a skeleton, not nothing, and not a sentinel: a subject that is true
    // from the selection alone.
    expect(text).toBe("When this issue is assigned to Agent");
  });

  it("uses the same fallback noun for a member and a squad", async () => {
    const mod = await load();
    for (const [type, noun] of [
      ["member", "Member"],
      ["squad", "Squad"],
    ] as const) {
      const text = mod.wakeupTrigger(
        { t, actorName: () => unsettled, actorNameContext: "echo" },
        preview({
          type: "issue_field",
          field: "assignee",
          assignee_type: type,
          assignee_id: "x",
        }),
      );
      expect(text, type).toBe(`When this issue is assigned to ${noun}`);
    }
  });

  it("never echoes an empty string", async () => {
    const mod = await load();
    const text = mod.wakeupTrigger(
      { t, actorName: () => unsettled, actorNameContext: "echo" },
      preview(),
    );
    const slot = text.replace(/^When this issue is assigned to /, "");
    expect(slot.length).toBeGreaterThan(0);
    expect(slot.trim()).toBe(slot);
  });

  it("names the actor once the directory answers, with no state of its own", async () => {
    const mod = await load();
    expect(
      mod.wakeupTrigger(
        { t, actorName: () => settled, actorNameContext: "echo" },
        preview(),
      ),
    ).toBe("When this issue is assigned to Ada Lovelace");
  });
});

describe("the readiness the sentence waits on is the ASSIGNEE's own type", () => {
  it("passes the condition's assignee_type and assignee_id to the resolver", async () => {
    // A sentence that asked for the wrong directory would blank (or assert)
    // for the wrong reason. The condition carries both fields; they must be
    // forwarded verbatim.
    const mod = await load();
    const seen: [string, string][] = [];
    mod.wakeupTrigger(
      {
        t,
        actorName: (type: string, id: string) => {
          seen.push([type, id]);
          return settled;
        },
      },
      preview({
        type: "issue_field",
        field: "assignee",
        assignee_type: "squad",
        assignee_id: "sq-9",
      }),
    );
    expect(seen).toEqual([["squad", "sq-9"]]);
  });
});

describe("readiness is per TYPE, not one combined flag", () => {
  /**
   * The regression iteration 253 shipped once and 254/256 had to fix twice: a
   * surface gated on `members && agents` blanks an agent-only value whenever
   * the member list is slow. On the wakeup surfaces the assignee of a
   * condition is the one directory-derived actor, so the question is whether
   * `resolveActorName` was handed a per-type readiness.
   *
   * `actorNameState` answers that, and this block pins the wiring: the
   * resolver these bundles pass is `useActorLookup().resolveActorName`, whose
   * readiness is `resolvedBy` — keyed per type — rather than `resolved` (the
   * combined flag the projects list's lead cell uses, because a lead genuinely
   * can be either type).
   */
  it("states a name when only the MEMBER directory is slow but the assignee is an agent", async () => {
    const mod = await load();
    const { actorNameState } = await import("./actor-name-state");
    const readiness = { member: false, agent: true, squad: false };
    const state = actorNameState({
      type: "agent",
      id: "agent-1",
      name: "Ada Lovelace",
      readiness,
    });
    expect(
      mod.wakeupTrigger({ t, actorName: () => state }, preview()),
    ).toBe("When this issue is assigned to Ada Lovelace");
  });

  it("withholds when the assignee's OWN directory is the one that has not answered", async () => {
    const mod = await load();
    const { actorNameState } = await import("./actor-name-state");
    const state = actorNameState({
      type: "agent",
      id: "agent-1",
      name: "Unknown Agent",
      readiness: { member: true, agent: false, squad: true },
    });
    expect(state.kind).toBe("unsettled");
    expect(
      mod.wakeupTrigger({ t, actorName: () => state }, preview()),
    ).toBe("When this issue is assigned to someone");
  });
});
