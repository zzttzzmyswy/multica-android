/**
 * Pure-function tests for the skill attached-file path validator. Ported from
 * web `useValidateNewFilePath` (packages/views/skills/components/skill-detail-page.tsx:175-198),
 * whose seven rejections the mobile add-file / rename rows must reproduce.
 *
 * The validator returns a stable error CODE rather than a translated string so
 * it stays a pure function; the UI maps the code onto `skills.detail.add_file.errors.*`.
 *
 * The two asymmetric rules at the end are the subtle ones. Directories are
 * inferred from paths, not stored, so a file named after an existing folder
 * merges into that folder's node when the tree is built (it vanishes from the
 * rail while still sitting in the draft), and a path nested under an existing
 * FILE can never be reached. Both directions are rejected.
 */
import { describe, expect, it } from "vitest";
import { SKILL_MD, validateSkillFilePath } from "./skill-file-paths";

describe("validateSkillFilePath", () => {
  const existing = [SKILL_MD, "scripts/run.sh", "README.md"];

  it("accepts a fresh nested path", () => {
    expect(validateSkillFilePath("templates/review.md", existing)).toBeNull();
    expect(validateSkillFilePath("scripts/setup.ts", existing)).toBeNull();
  });

  it("rejects an empty or whitespace-only path", () => {
    expect(validateSkillFilePath("", existing)).toBe("empty");
    expect(validateSkillFilePath("   ", existing)).toBe("empty");
  });

  it("rejects an absolute path", () => {
    expect(validateSkillFilePath("/etc/passwd", existing)).toBe("absolute");
  });

  it('rejects a path containing a ".." segment', () => {
    expect(validateSkillFilePath("../secret", existing)).toBe("double_dot");
    expect(validateSkillFilePath("a/../../b", existing)).toBe("double_dot");
  });

  it("rejects the reserved SKILL.md name", () => {
    expect(validateSkillFilePath(SKILL_MD, existing)).toBe("reserved");
    // Reserved wins over `exists` — the message must name the main file.
    expect(validateSkillFilePath(SKILL_MD, [SKILL_MD])).toBe("reserved");
  });

  it("rejects a path that already exists", () => {
    expect(validateSkillFilePath("README.md", existing)).toBe("exists");
    expect(validateSkillFilePath("scripts/run.sh", existing)).toBe("exists");
  });

  it("rejects a path that collides with an inferred directory", () => {
    // "scripts" is not stored anywhere; it exists only as a prefix.
    expect(validateSkillFilePath("scripts", existing)).toBe("is_directory");
  });

  it("rejects a path nested under an existing file", () => {
    expect(validateSkillFilePath("README.md/inner.txt", existing)).toBe("under_file");
    // SKILL.md is a file too — nothing may nest beneath the main file.
    expect(validateSkillFilePath("SKILL.md/inner.txt", existing)).toBe("under_file");
  });

  it("trims before judging, so padded valid paths pass", () => {
    expect(validateSkillFilePath("  templates/a.md  ", existing)).toBeNull();
    expect(validateSkillFilePath("  README.md  ", existing)).toBe("exists");
  });

  it("treats a same-named sibling under another directory as free", () => {
    // "README.md" is taken at the root, but "docs/README.md" is not.
    expect(validateSkillFilePath("docs/README.md", existing)).toBeNull();
  });
});
