import type { MemberWithUser } from "@multica/core/types";
import { matchesPinyin } from "./pinyin-match";

/**
 * Workspace member search helpers — port of web's search-command.tsx
 * member section (packages/views/search/search-command.tsx:99-113, 478-490).
 *
 * Two entry points into the member section:
 *   - `members` / `people` / `users` / `team` prefixes list every member;
 *   - any other query matches by name / email / role prefix (≥3 chars) /
 *     pinyin (full, initials, hybrid).
 */

export function memberInitials(name: string): string {
  return name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function matchesMember(member: MemberWithUser, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return (
    member.name.toLowerCase().includes(q) ||
    member.email.toLowerCase().includes(q) ||
    (q.length >= 3 && member.role.startsWith(q)) ||
    matchesPinyin(member.name, q.trim())
  );
}

const ALL_MEMBERS_PREFIXES = ["members", "people", "users", "team"];

export function wantsAllMembers(query: string): boolean {
  const q = query.trim().toLowerCase();
  return (
    q.length >= 3 && ALL_MEMBERS_PREFIXES.some((prefix) => prefix.startsWith(q))
  );
}

/** Filter + cap, mirroring web `filteredMembers` (10 max). */
export function filterMemberMatches(
  members: MemberWithUser[],
  query: string,
): MemberWithUser[] {
  const q = query.trim();
  if (!q) return [];
  return members
    .filter((member) => wantsAllMembers(q) || matchesMember(member, q))
    .slice(0, 10);
}