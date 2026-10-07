import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

import {
  buildSearchCommands,
  buildSearchPages,
  filterSearchCommands,
  filterSearchPages,
  matchesEntry,
} from "./search-commands";
import { setLocale } from "./i18n";

/**
 * The Pages + Commands groups of the search panel.
 *
 * These are ports of web's `navPages` and `commands` memos, so the tests pin
 * the *parity contract* rather than the implementation: the same 8
 * destinations, the same reachable commands, the same gating, and the same
 * asymmetric match rules. A future edit that drops or renames a row fails
 * here rather than silently shrinking the palette.
 */
describe("search pages", () => {
  beforeEach(() => setLocale("en"));

  it("carries web's eight destinations, in web's order", () => {
    expect(buildSearchPages().map((p) => p.key)).toEqual([
      "inbox",
      "myIssues",
      "issues",
      "projects",
      "agents",
      "runtimes",
      "skills",
      "settings",
    ]);
  });

  it("labels every destination with the app's shared vocabulary", () => {
    // `screen.settings` rather than `nav.more`: the row is a destination, and
    // the app already names that page Settings everywhere else.
    expect(
      Object.fromEntries(buildSearchPages().map((p) => [p.key, p.label])),
    ).toEqual({
      inbox: "Inbox",
      myIssues: "My Issues",
      issues: "Issues",
      projects: "Projects",
      agents: "Agents",
      runtimes: "Runtimes",
      skills: "Skills",
      settings: "Settings",
    });
  });

  it("matches on the label and on the keywords, case-insensitively", () => {
    const pages = buildSearchPages();
    const hit = (q: string) => filterSearchPages(pages, q).map((p) => p.key);

    expect(hit("agent")).toEqual(["agents"]);
    expect(hit("AGENT")).toEqual(["agents"]);
    expect(hit("settings")).toEqual(["settings"]);
    // Keyword-only needles — no label carries these words.
    expect(hit("kanban")).toEqual(["projects"]);
    expect(hit("bots")).toEqual(["agents"]);
  });

  it("finds CJK destinations by their own script", () => {
    setLocale("zh");
    const pages = buildSearchPages();
    const hit = (q: string) => filterSearchPages(pages, q).map((p) => p.key);

    expect(hit("设置")).toEqual(["settings"]);
    expect(hit("项目")).toEqual(["projects"]);
    expect(hit("收件箱")).toEqual(["inbox"]);
    // 智能体 is the zh label for Agents; the English keyword still reaches it.
    expect(hit("agent")).toEqual(["agents"]);
  });

  it("yields nothing for an empty query (web reserves the empty panel)", () => {
    expect(filterSearchPages(buildSearchPages(), "")).toEqual([]);
    expect(filterSearchPages(buildSearchPages(), "   ")).toEqual([]);
  });
});

describe("search commands", () => {
  beforeEach(() => setLocale("en"));

  it("lists creation and theme commands, in web's order", () => {
    expect(buildSearchCommands().map((c) => c.key)).toEqual([
      "new-issue",
      "new-project",
      "theme-light",
      "theme-dark",
      "theme-system",
    ]);
  });

  it("tags only the theme rows with the preference they select", () => {
    const commands = buildSearchCommands();
    expect(commands.filter((c) => c.theme).map((c) => [c.theme, c.key])).toEqual([
      ["light", "theme-light"],
      ["dark", "theme-dark"],
      ["system", "theme-system"],
    ]);
    // Exactly three: a stray `theme` field would make the screen render a
    // checkmark on a row that switches nothing.
    expect(commands.filter((c) => c.theme)).toHaveLength(3);
  });

  it("keeps only new-issue on an empty query (web's empty-state rule)", () => {
    expect(filterSearchCommands(buildSearchCommands(), "").map((c) => c.key)).toEqual([
      "new-issue",
    ]);
  });

  it("reaches commands by keyword once the reader types", () => {
    const commands = buildSearchCommands();
    const hit = (q: string) => filterSearchCommands(commands, q).map((c) => c.key);

    expect(hit("dark")).toEqual(["theme-dark"]);
    expect(hit("night")).toEqual(["theme-dark"]);
    expect(hit("dark mode")).toEqual([]);
    expect(hit("theme")).toEqual(["theme-light", "theme-dark", "theme-system"]);
    expect(hit("浅色")).toEqual(["theme-light"]);
    expect(hit("跟随系统")).toEqual(["theme-system"]);
  });

  it("omits web's issue-scoped rows, which this screen cannot reach", () => {
    // Mobile mounts the search header on Inbox and My Issues only, so web's
    // `currentIssueId` predicate is always false here. Porting those four rows
    // would ship four permanently-dead entries.
    const keys = buildSearchCommands().map((c) => c.key);
    expect(keys).not.toContain("copy-issue-link");
    expect(keys).not.toContain("copy-issue-identifier");
    expect(keys).not.toContain("fold-all-comments");
    expect(keys).not.toContain("unfold-all-comments");
  });
});

describe("matchesEntry", () => {
  it("trims the needle and ignores case on both sides", () => {
    const entry = { label: "Dark", keywords: ["theme"] };
    expect(matchesEntry(entry, "  DARK ")).toBe(true);
    expect(matchesEntry(entry, "THEME")).toBe(true);
    expect(matchesEntry(entry, "light")).toBe(false);
  });

  it("treats an empty needle as no match, so callers own the empty case", () => {
    // Returning true here would make `filterSearchPages` show all 8 rows on an
    // empty query, contradicting web's Recent-only empty state.
    expect(matchesEntry({ label: "Issues", keywords: [] }, "")).toBe(false);
  });
});
