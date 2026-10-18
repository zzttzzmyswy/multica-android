import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

/**
 * Iteration 257 (MYS-2228): the two sentence-level fallbacks a wakeup condition
 * retreats to when this client cannot name the assignee.
 *
 * The contract these keys carry is unusual and is what the shape assertions
 * below are for: they must read as a COMPLETE sentence that names NOBODY. That
 * rules out three things a careless edit would reintroduce:
 *
 *   - a `{{name}}` (or any other) placeholder, which would put the hole back;
 *   - an actor word — 「Unknown」 / 「未知」 / 「某智能体」 — which is the same
 *     unbacked claim in a different spelling;
 *   - the `wakeups.conditions.assigneeChanged` wording, which describes a
 *     BROADER rule than the `issue_field/assignee` condition actually stored.
 */
describe("wakeups assignee-unread i18n", () => {
  let mod: Awaited<ReturnType<typeof loadI18n>>;

  async function loadI18n() {
    return await import("./index");
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    mod = await loadI18n();
    mod.resetI18nForTests();
    mod.setLocale("en");
  });

  const ZH: Record<string, string> = {
    "wakeups.cond.assigneeUnread": "当此任务指派给某个人时",
    "wakeups.wait.assigneeUnread": "等待此任务被指派",
  };

  it("resolves in both locales with the exact copy", () => {
    expect(mod.translate("wakeups.cond.assigneeUnread")).toBe(
      "When this issue is assigned to someone",
    );
    expect(mod.translate("wakeups.wait.assigneeUnread")).toBe(
      "Waiting for this issue to be assigned",
    );
    mod.setLocale("zh");
    for (const [key, value] of Object.entries(ZH)) {
      expect(mod.translate(key), key).toBe(value);
    }
  });

  it("takes no parameters — the whole point is that nothing is substituted", () => {
    // A placeholder here would reintroduce the 「指派给 时」 hole the fallback
    // exists to remove, and `t` would happily render it empty.
    for (const key of Object.keys(ZH)) {
      const en = mod.translate(key);
      expect(en, key).not.toMatch(/\{\{/);
      expect(mod.translate(key, { name: "X" }), key).toBe(en);
    }
  });

  it("names no actor and asserts no lookup outcome", () => {
    mod.setLocale("zh");
    const forbidden = /Unknown|未知|{{|某智能体|某个智能体/;
    for (const key of Object.keys(ZH)) {
      expect(mod.translate(key), key).not.toMatch(forbidden);
    }
    mod.setLocale("en");
    for (const key of Object.keys(ZH)) {
      expect(mod.translate(key), key).not.toMatch(forbidden);
    }
  });

  it("differs from the assigneeChanged sentence it deliberately does not reuse", () => {
    for (const locale of ["en", "zh"] as const) {
      mod.setLocale(locale);
      expect(mod.translate("wakeups.cond.assigneeUnread"), locale).not.toBe(
        mod.translate("wakeups.conditions.assigneeChanged"),
      );
    }
  });

  it("uses the issue ENTITY noun in zh, per the glossary", () => {
    // `task` is the agent execution run; a filed unit of work is 任务. The
    // condition is about the issue, so the sentence has to say 任务.
    expect(ZH["wakeups.cond.assigneeUnread"]).toContain("任务");
    expect(ZH["wakeups.wait.assigneeUnread"]).toContain("任务");
  });
});
