import { describe, expect, it } from "vitest";
import {
  allSkillKeysSelected,
  detectSkillImportSource,
  isNameConflictError,
  skillImportUrlReady,
  summarizeSkillImportResults,
  toggleSkillKey,
  toggleVisibleSkillKeys,
  type SkillImportOutcomeRow,
} from "./skill-import";

describe("detectSkillImportSource", () => {
  it("recognises the three hosted sources", () => {
    expect(detectSkillImportSource("https://clawhub.ai/owner/skill")).toBe("clawhub");
    expect(detectSkillImportSource("https://skills.sh/owner/repo/skill")).toBe("skills_sh");
    expect(detectSkillImportSource("https://github.com/owner/repo")).toBe("github");
  });

  it("is case- and whitespace-insensitive, like web's lowercased match", () => {
    expect(detectSkillImportSource("  HTTPS://GitHub.com/Owner/Repo  ")).toBe("github");
  });

  it("returns null for hosts it does not know", () => {
    expect(detectSkillImportSource("https://example.com/skill")).toBeNull();
    expect(detectSkillImportSource("")).toBeNull();
  });
});

describe("skillImportUrlReady", () => {
  it("gates on a non-empty trimmed URL — web's only client check", () => {
    expect(skillImportUrlReady("https://github.com/o/r")).toBe(true);
    expect(skillImportUrlReady("   ")).toBe(false);
    expect(skillImportUrlReady("")).toBe(false);
  });
});

describe("isNameConflictError", () => {
  it("matches the server's conflict shapes", () => {
    expect(isNameConflictError("409 Conflict")).toBe(true);
    expect(isNameConflictError("skill already exists")).toBe(true);
    expect(isNameConflictError("UNIQUE constraint failed")).toBe(true);
  });

  it("does not match unrelated failures", () => {
    expect(isNameConflictError("network request failed")).toBe(false);
    expect(isNameConflictError("")).toBe(false);
  });
});

describe("toggleSkillKey", () => {
  it("adds then removes without mutating the input", () => {
    const start = new Set<string>();
    const added = toggleSkillKey(start, "a");
    expect([...added]).toEqual(["a"]);
    expect(start.size).toBe(0);
    expect([...toggleSkillKey(added, "a")]).toEqual([]);
  });
});

describe("allSkillKeysSelected", () => {
  it("requires a non-empty visible set, all selected", () => {
    expect(allSkillKeysSelected(new Set(["a", "b"]), ["a", "b"])).toBe(true);
    expect(allSkillKeysSelected(new Set(["a"]), ["a", "b"])).toBe(false);
    expect(allSkillKeysSelected(new Set(["a"]), [])).toBe(false);
  });
});

describe("toggleVisibleSkillKeys", () => {
  it("selects every visible key when not all are selected", () => {
    const next = toggleVisibleSkillKeys(new Set(["a"]), ["a", "b", "c"]);
    expect([...next].sort()).toEqual(["a", "b", "c"]);
  });

  it("clears only the visible keys, keeping hidden picks", () => {
    // "hidden" is selected but filtered out of the current search view.
    const next = toggleVisibleSkillKeys(new Set(["a", "b", "hidden"]), ["a", "b"]);
    expect([...next]).toEqual(["hidden"]);
  });

  it("does not mutate the input set", () => {
    const start = new Set(["a"]);
    toggleVisibleSkillKeys(start, ["a"]);
    expect([...start]).toEqual(["a"]);
  });
});

describe("summarizeSkillImportResults", () => {
  const rows: SkillImportOutcomeRow[] = [
    { key: "a", name: "A", outcome: "created" },
    { key: "b", name: "B", outcome: "updated" },
    { key: "c", name: "C", outcome: "skipped", error: "already exists" },
    { key: "d", name: "D", outcome: "failed", error: "daemon offline" },
    { key: "e", name: "E", outcome: "created" },
  ];

  it("buckets every row into exactly one count", () => {
    const summary = summarizeSkillImportResults(rows);
    expect(summary.created).toBe(2);
    expect(summary.updated).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.created + summary.updated + summary.skipped + summary.failed).toBe(
      rows.length,
    );
  });

  it("lists skipped + failed rows as problems, in input order", () => {
    const summary = summarizeSkillImportResults(rows);
    expect(summary.problems.map((row) => row.key)).toEqual(["c", "d"]);
  });

  it("handles an empty result set", () => {
    expect(summarizeSkillImportResults([])).toEqual({
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      problems: [],
    });
  });
});
