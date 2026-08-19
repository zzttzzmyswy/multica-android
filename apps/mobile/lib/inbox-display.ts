/**
 * Inbox title display helpers.
 *
 * Mirrors packages/views/inbox/components/inbox-display.ts. Keeping behavior
 * identical is required by apps/mobile/CLAUDE.md "Behavioral parity":
 * the title a user sees in the mobile inbox MUST match what they see on
 * web for the same item. When the web version changes, sync this file.
 */
import type { InboxItem } from "@multica/core/types";

function singleLine(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function stripQuickCreatePrefix(
  title: string,
  identifier?: string,
): string {
  const normalized = singleLine(title);
  if (!normalized) return "";
  if (identifier) {
    const exactPrefix = new RegExp(
      `^Created\\s+${escapeRegExp(identifier)}:\\s*`,
      "i",
    );
    const withoutExactPrefix = normalized.replace(exactPrefix, "");
    if (withoutExactPrefix !== normalized) return withoutExactPrefix.trim();
  }
  return normalized.replace(/^Created\s+[A-Z][A-Z0-9]*-\d+:\s*/i, "").trim();
}

export function getInboxDisplayTitle(item: InboxItem): string {
  const details = item.details ?? {};
  if (item.type === "quick_create_done") {
    const cleanedTitle = stripQuickCreatePrefix(item.title, details.identifier);
    if (cleanedTitle) return cleanedTitle;
    const prompt = singleLine(details.original_prompt);
    if (prompt) return prompt;
  }
  // Both non-success quick-create outcomes surface the user's original input
  // as the row title. Mirrors isQuickCreateOutcome in
  // packages/views/inbox/components/inbox-display.ts.
  if (item.type === "quick_create_failed" || item.type === "quick_create_unconfirmed") {
    const prompt = singleLine(details.original_prompt);
    if (prompt) return prompt;
  }
  return item.title;
}

/**
 * The two non-success quick-create outcomes. They share a row shape (original
 * prompt + recovery affordance) but must never share failure wording: the
 * unconfirmed outcome means we could not verify the result, not that it failed.
 *
 * Mirrors `isQuickCreateOutcome` in
 * packages/views/inbox/components/inbox-display.ts (Behavioral parity).
 */
export function isQuickCreateOutcome(type: InboxItem["type"]): boolean {
  return type === "quick_create_failed" || type === "quick_create_unconfirmed";
}

/**
 * Seed payload for the inbox detail's "Edit as advanced form" recovery
 * affordance. Returns null when the item isn't a recoverable quick-create
 * outcome (no original prompt to recover) — callers render no button then.
 * Mirrors web inbox-page.tsx `detail.edit_advanced`: the prompt becomes the
 * manual create-form's description and the outcome's agent hint becomes the
 * assignee candidate (still editable).
 */
export function getQuickCreateEditSeed(item: InboxItem): {
  description: string;
  agentId?: string;
} | null {
  if (!isQuickCreateOutcome(item.type)) return null;
  const prompt = (item.details?.original_prompt ?? "").trim();
  if (!prompt) return null;
  const agentId = item.details?.agent_id;
  return {
    description: prompt,
    ...(agentId ? { agentId } : {}),
  };
}

/**
 * Which toggle action a details view offers for an inbox item — the button
 * always reverses the view the item is being read in (web
 * packages/views/inbox/components/inbox-page.tsx detail section): reading in
 * the MAIN view offers Archive; reading in the ARCHIVED view offers Unarchive.
 */
export function getInboxArchiveMode(view: "inbox" | "archived"): "archive" | "unarchive" {
  return view === "archived" ? "unarchive" : "archive";
}

/**
 * Deduplicate inbox items by issue_id (Linear-style: one entry per issue).
 *
 * Mirrors packages/core/inbox/queries.ts deduplicateInboxItems. **MUST stay
 * aligned with that function** — see the inbox dedup incident in this file's
 * companion `apps/mobile/CLAUDE.md` "Behavioral parity" section. Skipping
 * this step makes the same workspace/user show different unread counts on
 * mobile vs web.
 *
 * Steps:
 *   1. Drop archived rows (these never appear in web's inbox view).
 *   2. Group by `issue_id` (fall back to `id` for items with no issue
 *      attached — e.g. quick_create_failed).
 *   3. In each group, keep the newest by `created_at`.
 *   4. Preserve the newest grouped `comment_id` anchor when the newest row
 *      is a later status/metadata event for the same issue.
 *   5. Sort the result newest-first.
 */
export function deduplicateInboxItems(items: InboxItem[]): InboxItem[] {
  return groupInboxItemsByIssue(items.filter((i) => !i.archived));
}

/**
 * Same grouping for the archived sub-view. The `archived` filter is what
 * makes an optimistic unarchive drop the row out of the archived list
 * immediately — mirroring how `deduplicateInboxItems`' filter drops an
 * optimistically archived row out of the main list. Mirrors packages/core/
 * inbox/queries.ts deduplicateArchivedInboxItems (identical behavior; the
 * comment_id anchor dance stays intact).
 */
export function deduplicateArchivedInboxItems(items: InboxItem[]): InboxItem[] {
  return groupInboxItemsByIssue(items.filter((i) => i.archived));
}

/**
 * Group inbox items by issue and keep the newest row per issue.
 *
 * The shared core of `deduplicateInboxItems` / `deduplicateArchivedInboxItems`
 * — mirrors packages/core/inbox/queries.ts groupInboxItemsByIssue. **MUST not
 * drift from web**: the comment_id-anchor handling below is what keeps a
 * newer status/metadata row from losing the tap-through highlight that an
 * older comment row carried.
 */
export function groupInboxItemsByIssue(items: InboxItem[]): InboxItem[] {
  const groups = new Map<string, InboxItem[]>();
  for (const item of items) {
    const key = item.issue_id ?? item.id;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  const merged: InboxItem[] = [];
  for (const group of groups.values()) {
    group.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    const newest = group[0];
    if (!newest) continue;

    const commentId =
      newest.details?.comment_id ??
      group.find((item) => item.details?.comment_id)?.details?.comment_id;

    if (commentId && newest.details?.comment_id !== commentId) {
      merged.push({
        ...newest,
        details: { ...(newest.details ?? {}), comment_id: commentId },
      });
      continue;
    }

    merged.push(newest);
  }
  return merged.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}
