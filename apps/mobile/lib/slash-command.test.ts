import { describe, expect, it } from "vitest";
import {
  buildBuiltinCommandItems,
  isQuickActionItem,
  matchSlashTrigger,
  quickActionIdFromItem,
  replaceSlashTrigger,
  BUILTIN_NOTE_ITEM,
  MAX_SLASH_ITEMS,
  QUICK_ACTION_ITEM_PREFIX,
} from "./slash-command";

describe("matchSlashTrigger", () => {
  it("returns null when there is no slash token", () => {
    expect(matchSlashTrigger("")).toBeNull();
    expect(matchSlashTrigger("hello")).toBeNull();
    expect(matchSlashTrigger("hello ")).toBeNull();
    expect(matchSlashTrigger("hello world")).toBeNull();
  });

  it("matches a trailing slash word and keeps the query case", () => {
    expect(matchSlashTrigger("/query")).toEqual({ from: 0, query: "query" });
    expect(matchSlashTrigger("hello /usr")).toEqual({ from: 6, query: "usr" });
    expect(matchSlashTrigger("hello /USR")).toEqual({ from: 6, query: "USR" });
  });

  it("matches a bare slash as an empty query", () => {
    expect(matchSlashTrigger("hello /")).toEqual({ from: 6, query: "" });
  });

  it("matches when a newline precedes the token", () => {
    expect(matchSlashTrigger("hello\n/note")).toEqual({ from: 6, query: "note" });
  });

  it("only matches a token that ends the draft (word boundary semantics)", () => {
    expect(matchSlashTrigger("hello /query world")).toBeNull();
  });

  it("rejects path-like tokens so a pasted path never opens the menu", () => {
    expect(matchSlashTrigger("/usr/local/bin")).toBeNull();
    expect(matchSlashTrigger("a/b")).toBeNull();
    expect(matchSlashTrigger("go to a/b/c")).toBeNull();
  });

  it("rejects tokens with characters outside the allowed set", () => {
    expect(matchSlashTrigger("hello /查")).toBeNull();
    expect(matchSlashTrigger("hello /query!")).toBeNull();
  });
});

describe("buildBuiltinCommandItems", () => {
  const actions = [
    { id: "qa1", name: "Review", description: "Ask the agent to review" },
    { id: "qa2", name: "Deploy" },
  ];

  it("offers the built-in note when nothing else matches", () => {
    expect(buildBuiltinCommandItems("", [])).toEqual([BUILTIN_NOTE_ITEM]);
    expect(buildBuiltinCommandItems("no", [])).toEqual([BUILTIN_NOTE_ITEM]);
  });

  it("leads with quick actions before the built-in note", () => {
    const items = buildBuiltinCommandItems("", actions);
    expect(items.map((i) => i.id)).toEqual([
      `${QUICK_ACTION_ITEM_PREFIX}qa1`,
      `${QUICK_ACTION_ITEM_PREFIX}qa2`,
      "note",
    ]);
    expect(items[0]!.description).toBe("Ask the agent to review");
    expect(items[1]!.description).toBeUndefined();
  });

  it("prefix-filters labels case-insensitively", () => {
    expect(buildBuiltinCommandItems("re", actions).map((i) => i.label)).toEqual([
      "Review",
    ]);
    expect(buildBuiltinCommandItems("RE", actions).map((i) => i.label)).toEqual([
      "Review",
    ]);
    expect(buildBuiltinCommandItems("deploy", actions).map((i) => i.label)).toEqual([
      "Deploy",
    ]);
    expect(buildBuiltinCommandItems("no", actions).map((i) => i.label)).toEqual([
      "note",
    ]);
    expect(buildBuiltinCommandItems("xyz", actions)).toEqual([]);
  });

  it("caps the menu at MAX_SLASH_ITEMS", () => {
    const many = Array.from({ length: MAX_SLASH_ITEMS + 3 }, (_, i) => ({
      id: `qa${i}`,
      name: `Action ${i}`,
    }));
    const items = buildBuiltinCommandItems("", many);
    expect(items.length).toBe(MAX_SLASH_ITEMS);
  });
});

describe("quick action item helpers", () => {
  it("identifies quick-action items and extracts the id", () => {
    const item = buildBuiltinCommandItems("", [{ id: "abc", name: "Pick" }])[0]!;
    expect(isQuickActionItem(item)).toBe(true);
    expect(quickActionIdFromItem(item)).toBe("abc");
    expect(isQuickActionItem(BUILTIN_NOTE_ITEM)).toBe(false);
  });
});

describe("replaceSlashTrigger", () => {
  it("replaces the trailing slash token, preserving the lead text", () => {
    expect(
      replaceSlashTrigger("hello /query", 6, "query", "**rendered**"),
    ).toBe("hello **rendered**");
    expect(replaceSlashTrigger("/query", 0, "query", "X")).toBe("X");
    expect(replaceSlashTrigger("abc\n/query", 4, "query", "X")).toBe("abc\nX");
  });

  it("replaces a bare slash (empty query)", () => {
    expect(replaceSlashTrigger("hello /", 6, "", "/note ")).toBe("hello /note ");
  });

  it("leaves the draft untouched when the token changed mid-flight", () => {
    expect(
      replaceSlashTrigger("hello /other", 6, "query", "**rendered**"),
    ).toBe("hello /other");
  });
});