/**
 * Pure display helpers for the IM-style chat session list (MYS-449).
 *
 * Mirrors `packages/views/chat/components/chat-thread-list.tsx` so the mobile
 * session sheet renders the same shapes as web:
 *   - formatChatTime: today → clock time, this year → M/D, else full date
 *   - toPreview: collapse a markdown / multi-line message into one line
 *   - unreadBadgeText: the red count badge text, capped at "99+"
 *   - resolveSessionAgentName: per-row agent identity shown before the preview
 *     (web MUL-6264 / #7087)
 *
 * Pure functions only — no RN / network imports, so they stay Node-testable.
 */

// IM-style timestamp: today → clock, this year → M/D, else full date.
// `now` is injectable so tests can pin the three branches.
export function formatChatTime(dateStr: string, now: Date = new Date()): string {
  const d = new Date(dateStr);
  if (!isNaN(d.getTime()) && d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString([], { month: "numeric", day: "numeric" });
  }
  return d.toLocaleDateString();
}

// Collapse a (possibly markdown / multi-line) message into a one-line preview.
// Same rules as web's `toPreview` in chat-thread-list.tsx.
export function toPreview(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#*`>~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Red unread count badge text. Web renders `unread > 99 ? "99+" : unread`
// gated on `unread > 0`; we keep the same cap here and let the row decide
// whether to render the badge at all.
export function unreadBadgeText(unread?: number | null): string {
  if (typeof unread !== "number" || !Number.isFinite(unread)) {
    return "";
  }
  return unread > 99 ? "99+" : String(unread);
}

// Per-row agent identity shown before the preview (web MUL-6264 / #7087):
// resolve the agent name via the id→name map, trimming whitespace and treating
// a blank / missing name as "no agent label". Mirrors web's
// `agent?.name.trim() || null` so a session without a resolvable agent keeps
// its existing preview untouched.
export function resolveSessionAgentName(
  agentId: string | null | undefined,
  agentNameById: ReadonlyMap<string, string>,
): string | null {
  if (!agentId) return null;
  const name = agentNameById.get(agentId);
  if (!name) return null;
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : null;
}
