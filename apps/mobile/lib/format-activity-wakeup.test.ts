import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TimelineEntry } from "@multica/core/types";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Iteration 214 (MYS-2023). Before this change `formatActivity` had no branch
// for any `wakeup_*` action, so all five fell through to `entry.action` and the
// timeline showed bare English enum strings — `wakeup_checkin` — over a
// deployment that had already written 1947 of them. These tests pin the
// sentences AND the fallback: the fallback must survive, because a future
// server may add a sixth wakeup action.

function entry(over: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    type: "activity",
    id: "e1",
    actor_type: "agent",
    actor_id: "a1",
    created_at: "2026-10-09T00:00:00Z",
    ...over,
  } as TimelineEntry;
}

/** The wakeup preview bag the server stores on an entry, as probed live. */
const STORED = {
  id: "w1",
  kind: "event" as const,
  mode: "once" as const,
  agent_id: "a1",
  timezone: "UTC",
  condition: { type: "issue_field" as const, field: "status" as const, value: "in_review" },
  event_types: ["issue.status_changed"],
};

/** The status keys this suite names, as `useStatusLabel` resolves them. A
 *  condition stores the KEY, so without the resolver the sentence prints
 *  `in_review` — which is the bug class this round exists to remove. */
const STATUS_LABELS: Record<string, string> = {
  in_review: "In Review",
};

async function load() {
  return await import("./format-activity");
}

async function loadI18n() {
  return await import("./i18n");
}

describe("formatActivity — wakeup actions", () => {
  let mod: Awaited<ReturnType<typeof load>>;
  let i18n: Awaited<ReturnType<typeof loadI18n>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    i18n = await import("./i18n");
    i18n.resetI18nForTests();
    i18n.setLocale("en");
    mod = await load();
  });

  const resolve = (type: string | null | undefined, id: string | null | undefined) =>
    (type === "agent" ? "Agent One" : undefined) ?? id ?? "System";

  /** The third argument `ActivityRow` actually passes — a status key rendered
   *  in the viewer's language. Without it a condition naming a status prints
   *  the raw key, which is the failure this test would otherwise bake in. */
  const statusLabel = (key: string) => STATUS_LABELS[key] ?? key;

  it("never renders a bare wakeup enum string", () => {
    const actions = [
      "wakeup_created",
      "wakeup_triggered",
      "wakeup_timed_out",
      "wakeup_paused",
      "wakeup_checkin",
    ];
    for (const action of actions) {
      const text = mod.formatActivity(
        entry({ action, details: { wakeup: STORED } }),
        resolve,
      );
      expect(text).not.toBe(action);
      expect(text).not.toContain("wakeup_");
    }
  });

  it("says what a created rule watches and which agent it wakes", () => {
    const text = mod.formatActivity(
      entry({ action: "wakeup_created", details: { wakeup: STORED } }),
      resolve,
      statusLabel,
    );
    // The condition sentence, not the raw status key.
    expect(text).toContain("In Review");
    expect(text).toContain("Agent One");
  });

  it("names the manual trigger by who pressed it", () => {
    const text = mod.formatActivity(
      entry({
        action: "wakeup_triggered",
        details: {
          wakeup: STORED,
          events: ["wakeup.manual"],
          actor_id: "u1",
        },
      }),
      resolve,
    );
    expect(text).toContain("u1");
    expect(text).toContain("Agent One");
  });

  it("distinguishes a merged run from a plain trigger", () => {
    const plain = mod.formatActivity(
      entry({ action: "wakeup_triggered", details: { wakeup: STORED } }),
      resolve,
    );
    const merged = mod.formatActivity(
      entry({
        action: "wakeup_triggered",
        details: { wakeup: STORED, outcome: "merged" },
      }),
      resolve,
    );
    expect(merged).not.toBe(plain);
  });

  it("distinguishes timing out into a run from timing out into nothing", () => {
    const woke = mod.formatActivity(
      entry({
        action: "wakeup_timed_out",
        details: { wakeup: STORED, woke: true },
      }),
      resolve,
    );
    const ended = mod.formatActivity(
      entry({
        action: "wakeup_timed_out",
        details: { wakeup: STORED, woke: false },
      }),
      resolve,
    );
    expect(woke).not.toBe(ended);
    expect(woke).toContain("Agent One");
  });

  it("explains a platform pause with its reason", () => {
    const text = mod.formatActivity(
      entry({ action: "wakeup_paused", details: { reason: "rate" } }),
      resolve,
    );
    expect(text).toContain("12");
  });

  it("carries the check-in note, and the count when coalesced", () => {
    const one = mod.formatActivity(
      entry({
        action: "wakeup_checkin",
        details: { note: "nothing to do" },
      }),
      resolve,
    );
    expect(one).toContain("nothing to do");

    const many = mod.formatActivity(
      entry({
        action: "wakeup_checkin",
        coalesced_count: 4,
        details: { note: "nothing to do" },
      }),
      resolve,
    );
    expect(many).toContain("4");
    expect(many).toContain("nothing to do");
    expect(many).not.toBe(one);
  });

  it("describes the child-done rule's stage and count", () => {
    const all = mod.formatActivity(
      entry({
        action: "wakeup_triggered",
        details: { rule: "child_done", total: 3, target_type: "agent", target_id: "a1" },
      }),
      resolve,
    );
    expect(all).toContain("3");
    const staged = mod.formatActivity(
      entry({
        action: "wakeup_triggered",
        details: {
          rule: "child_done",
          stage: 2,
          total: 3,
          target_type: "agent",
          target_id: "a1",
        },
      }),
      resolve,
    );
    expect(staged).toContain("2");
    expect(staged).not.toBe(all);
  });

  it("keeps the unknown-action fallback for a future wakeup action", () => {
    // The rule this whole file must not break: an action this build predates
    // still renders as itself rather than crashing or vanishing.
    const future = mod.formatActivity(
      entry({ action: "wakeup_something_new", details: {} }),
      resolve,
    );
    expect(future).toBe("wakeup_something_new");
  });

  it("resolves the wakeup sentences in Chinese too", () => {
    i18n.setLocale("zh");
    const text = mod.formatActivity(
      entry({ action: "wakeup_checkin", details: { note: "无变化" } }),
      resolve,
    );
    expect(text).toContain("无变化");
    expect(text).not.toContain("silent check");
  });
});
