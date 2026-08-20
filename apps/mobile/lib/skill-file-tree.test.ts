/**
 * Pure-function tests for the skill file tree builder. Mirrors the tree shape
 * web renders in packages/views/skills/components/file-tree.tsx (`buildTree`):
 * rooted at the file list, SKILL.md pinned to the top, directories before
 * files at each level, siblings sorted by name. The mobile skill detail page
 * feeds it the full path set (SKILL.md + supporting files) and renders the
 * result with expand/collapse.
 */
import { describe, expect, it } from "vitest";
import { buildSkillFileTree } from "./skill-file-tree";

describe("buildSkillFileTree", () => {
  it("returns an empty tree for an empty path set", () => {
    expect(buildSkillFileTree([])).toEqual([]);
  });

  it("pins SKILL.md to the top of the root level", () => {
    const tree = buildSkillFileTree(["run.sh", "SKILL.md", "README.md"]);
    expect(tree.map((n) => n.path)).toEqual(["SKILL.md", "README.md", "run.sh"]);
  });

  it("groups files under a shared directory and sorts siblings by name", () => {
    const tree = buildSkillFileTree(["SKILL.md", "scripts/run.sh", "scripts/setup.ts", "README.md"]);
    expect(tree.map((n) => n.path)).toEqual(["SKILL.md", "scripts", "README.md"]);
    const scripts = tree.find((n) => n.path === "scripts")!;
    expect(scripts.isDirectory).toBe(true);
    expect(scripts.children.map((c) => c.path)).toEqual([
      "scripts/run.sh",
      "scripts/setup.ts",
    ]);
  });

  it("builds nested directory levels recursively", () => {
    const tree = buildSkillFileTree(["SKILL.md", "a/b/c.txt", "a/b/d.txt"]);
    const a = tree.find((n) => n.path === "a")!;
    expect(a.isDirectory).toBe(true);
    const b = a.children.find((n) => n.path === "a/b")!;
    expect(b.isDirectory).toBe(true);
    expect(b.children.map((c) => c.path)).toEqual(["a/b/c.txt", "a/b/d.txt"]);
  });

  it("puts directories before files at the same level (after SKILL.md)", () => {
    const tree = buildSkillFileTree(["z.txt", "m-dir/n.txt", "a-dir/k.txt"]);
    expect(tree.map((n) => n.path)).toEqual(["a-dir", "m-dir", "z.txt"]);
  });

  it("treats a two-part nesting as directory only when something lives inside", () => {
    const tree = buildSkillFileTree(["SKILL.md", "docs/index.md"]);
    const docs = tree.find((n) => n.path === "docs")!;
    expect(docs.isDirectory).toBe(true);
    expect(docs.children).toHaveLength(1);
    expect(docs.children[0].path).toBe("docs/index.md");
  });

  it("keeps leaf-only paths as flat files when there is no directory", () => {
    const tree = buildSkillFileTree(["README.md", "LICENSE"]);
    expect(tree.every((n) => !n.isDirectory)).toBe(true);
    // localeCompare order (web sortNodes semantics), no directory grouping.
    expect(tree.map((n) => n.path)).toEqual(["LICENSE", "README.md"]);
  });

  it("does not pin a nested SKILL.md (only the root primary file)", () => {
    const tree = buildSkillFileTree(["docs/SKILL.md", "run.sh"]);
    expect(tree.map((n) => n.path)).toEqual(["docs", "run.sh"]);
  });
});