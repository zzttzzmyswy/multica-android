import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

import type { Issue, IssueDuplicates } from "@multica/core/types";
import {
  DUPLICATE_SUGGESTION_LIMIT,
  duplicateSuggestionGroups,
  markDuplicateExcludeIds,
  showMarkDuplicateAction,
} from "./issue-duplicates";

function issue(over: Partial<Issue> = {}): Issue {
  return {
    id: "i1",
    workspace_id: "ws",
    number: 2,
    identifier: "MUL-2",
    title: "Some issue",
    description: null,
    status: "todo",
    priority: "none",
    assignee_type: null,
    assignee_id: null,
    creator_type: "member",
    creator_id: "u1",
    parent_issue_id: null,
    project_id: null,
    position: 0,
    stage: null,
    start_date: null,
    due_date: null,
    metadata: {},
    properties: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  } as Issue;
}

const ORIGINAL = { id: "orig", identifier: "MUL-1", title: "Original", status: "todo" };
const DUPLICATE = issue({ id: "dup", identifier: "MUL-9", status: "cancelled", duplicate_of: ORIGINAL });

const relations = (duplicates: Issue[]): IssueDuplicates => ({
  duplicate_of: null,
  duplicates,
});

describe("showMarkDuplicateAction", () => {
  it("hides the action only for an issue that is itself a duplicate", () => {
    expect(showMarkDuplicateAction(DUPLICATE)).toBe(false);
    expect(showMarkDuplicateAction(issue())).toBe(true);
    expect(showMarkDuplicateAction(issue({ status: "cancelled", duplicate_of: null }))).toBe(true);
    expect(showMarkDuplicateAction(issue({ status: "done" }))).toBe(true);
  });

  it("stays offered for an issue that already HAS duplicates", () => {
    // That refusal (`issue_has_duplicates`) is about the TARGET, not this
    // issue, and the server names it — so hiding the entry would remove a
    // valid action to pre-empt a sentence the reader can act on.
    expect(showMarkDuplicateAction(issue())).toBe(true);
  });
});

describe("duplicateSuggestionGroups", () => {
  it("drops candidates that cannot be an original", () => {
    const groups = duplicateSuggestionGroups(
      [DUPLICATE, issue({ id: "ok" })],
      [],
      { excludeIds: [] },
    );
    expect(groups[0].issues.map((i) => i.id)).toEqual(["ok"]);
  });

  it("drops excluded ids", () => {
    const groups = duplicateSuggestionGroups(
      [issue({ id: "self" }), issue({ id: "keep" })],
      [],
      { excludeIds: ["self"] },
    );
    expect(groups[0].issues.map((i) => i.id)).toEqual(["keep"]);
  });

  it("lists an issue found by both sources only once, under 'similar'", () => {
    const both = issue({ id: "both" });
    const groups = duplicateSuggestionGroups([both], [both, issue({ id: "recent-only" })], {
      excludeIds: [],
    });
    expect(groups[0].issues.map((i) => i.id)).toEqual(["both"]);
    expect(groups[1].issues.map((i) => i.id)).toEqual(["recent-only"]);
  });

  it("caps each group at the suggestion limit", () => {
    const many = Array.from({ length: 20 }, (_, n) => issue({ id: `i${n}` }));
    const groups = duplicateSuggestionGroups(many, many, { excludeIds: [] });
    expect(groups[0].issues).toHaveLength(DUPLICATE_SUGGESTION_LIMIT);
    // Each group caps INDEPENDENTLY, and the recents still skip whatever the
    // similar group already showed — so the second group is the NEXT six, not
    // an empty list. A reader who scrolled past six near-identical titles gets
    // six fresh ones rather than a repeated list.
    expect(groups[1].issues).toHaveLength(DUPLICATE_SUGGESTION_LIMIT);
    const shown = new Set(groups[0].issues.map((i) => i.id));
    expect(groups[1].issues.some((i) => shown.has(i.id))).toBe(false);
  });

  it("keeps both group keys present even when empty", () => {
    // The route drops empty groups before rendering; keeping the shape stable
    // means the order (similar, then recent) can never flip.
    const groups = duplicateSuggestionGroups([], [], { excludeIds: [] });
    expect(groups.map((g) => g.key)).toEqual(["similar", "recent"]);
    expect(groups.every((g) => g.issues.length === 0)).toBe(true);
  });
});

describe("markDuplicateExcludeIds", () => {
  it("excludes only the issue itself while the relation is unread", () => {
    expect(markDuplicateExcludeIds("self", undefined)).toEqual(["self"]);
  });

  it("excludes the issue's own duplicates once the relation is known", () => {
    expect(
      markDuplicateExcludeIds("self", relations([issue({ id: "a" }), issue({ id: "b" })]))
        .sort(),
    ).toEqual(["a", "b", "self"]);
  });
});

describe("locale coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves every duplicate string in both locales", async () => {
    const i18n = await import("./i18n");
    i18n.resetI18nForTests();
    const keys = [
      "duplicates.bannerPrefix",
      "duplicates.unmark",
      "duplicates.sectionTitle",
      "duplicates.markAction",
      "duplicates.markTitle",
      "duplicates.markDescription",
      "duplicates.markSuccess",
      "duplicates.markFailed",
      "duplicates.errorTargetIsDuplicate",
      "duplicates.errorHasDuplicates",
      "duplicates.suggestedSimilar",
      "duplicates.suggestedRecent",
    ];
    for (const key of keys) {
      i18n.setLocale("en");
      const en = i18n.translate(key);
      expect(en, key).not.toBe(key);
      expect(en.length, key).toBeGreaterThan(0);
      i18n.setLocale("zh");
      const zh = i18n.translate(key);
      expect(zh, key).not.toBe(key);
      expect(zh.length, key).toBeGreaterThan(0);
      expect(zh, key).not.toBe(en);
    }
  });
});
