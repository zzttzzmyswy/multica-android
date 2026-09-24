/**
 * Skill attached-file path validation — pure, i18n-free.
 *
 * Ported from web `useValidateNewFilePath`
 * (packages/views/skills/components/skill-detail-page.tsx:175-198). Web returns
 * a translated string from inside a hook; mobile returns a stable error code
 * and lets the caller map it onto `skills.detail.add_file.errors.*`, so the
 * rule set stays unit-testable without booting i18n.
 *
 * Directories are NOT stored — the server keeps a flat list of file paths and
 * the tree infers folders from the `/` separators. That is why the last two
 * rules are asymmetric: a file named after an existing folder merges into that
 * folder's node when the tree is built (it drops off the rail while still
 * sitting in the draft), and a path nested under an existing FILE can never be
 * rendered at all.
 */

import type { SkillFile } from "@multica/core/types";

export const SKILL_MD = "SKILL.md";

/**
 * The editable half of a `SkillFile`. `id` / `skill_id` / the timestamps are
 * assigned by the server on upsert, so a not-yet-saved file has none of them —
 * and the wholesale save sends only path + content anyway.
 */
export type SkillFileDraft = Pick<SkillFile, "path" | "content">;

export type SkillFilePathError =
  | "empty"
  | "absolute"
  | "double_dot"
  | "reserved"
  | "exists"
  | "is_directory"
  | "under_file";

/**
 * Returns the rejection code for `path`, or null when it is a legal new path.
 *
 * @param path     candidate path, as typed (trimmed internally)
 * @param existing every path already in the skill, INCLUDING `SKILL.md` —
 *                 the main file participates in the nesting rules like any
 *                 other file, so nothing may be created beneath it.
 */
export function validateSkillFilePath(
  path: string,
  existing: string[],
): SkillFilePathError | null {
  const p = path.trim();
  if (!p) return "empty";
  if (p.startsWith("/")) return "absolute";
  if (p.split("/").includes("..")) return "double_dot";
  if (p === SKILL_MD) return "reserved";
  if (existing.includes(p)) return "exists";
  if (existing.some((other) => other.startsWith(`${p}/`))) return "is_directory";
  if (existing.some((other) => p.startsWith(`${other}/`))) return "under_file";
  return null;
}

/** The full path set a skill renders: the main file plus every attached file. */
export function skillPathSet(files: { path: string }[]): string[] {
  return [SKILL_MD, ...files.map((f) => f.path)];
}
