/**
 * Workspace slug helpers (MYS-371).
 *
 * Web derives slugs with pinyin romanization so a Chinese workspace name
 * still produces a URL (packages/views/workspace/slug.ts). Mobile
 * deliberately skips the pinyin dependency: a pure non-ASCII name yields ""
 * and the create form leaves the slug field for the user to type by hand —
 * a single self-hosted client has no need to romanize, and a wrong
 * reading is harder to notice than an empty field. ASCII names follow the
 * same collapse/trim algorithm web applies after romanization.
 */

/** Same contract as web `WORKSPACE_SLUG_REGEX` (packages/views/workspace/slug.ts).
 *  Lowercase letters + digits, segments joined by single hyphens. */
export const WORKSPACE_SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Derive a slug candidate from a workspace name.
 *
 * - Lowercases and maps every non-alphanumeric run to a single hyphen,
 *   trimming leading/trailing hyphens (web: nameToWorkspaceSlug).
 * - Returns "" for names with no ASCII alphanumerics at all (Chinese,
 *   kana, emoji, symbols) so the form can ask the user to fill the slug
 *   by hand rather than guess a reading.
 */
export function deriveSlug(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  // Pure non-ASCII (no latin letters/digits anywhere) → let the user fill
  // it in. Mixed names keep the ASCII part.
  if (!/[a-z0-9]/i.test(trimmed)) return "";
  return trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}