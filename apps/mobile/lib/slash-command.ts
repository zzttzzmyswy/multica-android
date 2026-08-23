/**
 * Pure helpers backing the issue comment composer's `/` command menu —
 * mobile mirror of the pure-function parts of web's
 * `packages/views/editor/extensions/slash-command-suggestion.tsx`
 * (`buildBuiltinCommandItems`, quick-action id helpers) plus `use-quick-action-menu.ts`
 * catalog semantics (workspace active quick actions in front, `/note` built-in).
 *
 * Platform divergence (documented in MYS-681): mobile's composer input is a
 * plain RN TextInput with no controlled selection, so it cannot detect "the
 * user typed `/` at the caret" the way Tiptap's arming plugin does (web
 * `suggestion-trigger-arming.ts` rejects pasted paths like `/usr/local/bin`).
 * Instead we trigger only on the FINAL whitespace-delimited word of the draft
 * matching `^/[A-Za-z0-9_-]*$` — a typed trailing token is the 99%-use case,
 * and the same path-paste case (`/usr/local/bin` can never be a single final
 * word) is rejected by the regex itself. Mid-line `/` stays an accepted
 * platform difference.
 */

export interface SlashCommandItem {
  id: string;
  label: string;
  description?: string;
}

export interface SlashTriggerMatch {
  /** Index in `draft` where the `/` token starts. */
  from: number;
  /** Text after the `/`, verbatim (prefix filtering lowercases it). */
  query: string;
}

/** Web MAX_ITEMS — `slash-command-suggestion.tsx:31`. */
export const MAX_SLASH_ITEMS = 20;

/** Web QUICK_ACTION_ITEM_PREFIX — `slash-command-suggestion.tsx:269`. */
export const QUICK_ACTION_ITEM_PREFIX = "quick-action:";

/** Mobile's mirror of web BUILTIN_COMMANDS (single `/note`). The label is
 *  deliberately not translated — web keeps the typed `/note` verbatim and
 *  only localizes the description line, which mobile omits. */
export const BUILTIN_NOTE_ITEM: SlashCommandItem = {
  id: "note",
  label: "note",
};

/** Trailing word must be exactly `/`, zero or more command chars. */
const SLASH_TOKEN_RE = /^\/[A-Za-z0-9_-]*$/;

export function matchSlashTrigger(draft: string): SlashTriggerMatch | null {
  const lastBreak = Math.max(
    draft.lastIndexOf(" "),
    draft.lastIndexOf("\n"),
  );
  const from = lastBreak + 1;
  const token = draft.slice(from);
  if (!SLASH_TOKEN_RE.test(token)) return null;
  return { from, query: token.slice(1) };
}

export function isQuickActionItem(item: SlashCommandItem): boolean {
  return item.id.startsWith(QUICK_ACTION_ITEM_PREFIX);
}

export function quickActionIdFromItem(item: SlashCommandItem): string {
  return item.id.slice(QUICK_ACTION_ITEM_PREFIX.length);
}

/** Mirrors web `buildBuiltinCommandItems` — active quick actions lead,
 *  `/note` trails, prefix-filter on label, hard cap at MAX_ITEMS. */
export function buildBuiltinCommandItems(
  query: string,
  quickActions: { id: string; name: string; description?: string }[] = [],
): SlashCommandItem[] {
  const q = query.toLowerCase();
  const actionItems: SlashCommandItem[] = quickActions.map((a) => ({
    id: `${QUICK_ACTION_ITEM_PREFIX}${a.id}`,
    label: a.name,
    description: a.description || undefined,
  }));
  return [...actionItems, BUILTIN_NOTE_ITEM]
    .filter((c) => c.label.toLowerCase().startsWith(q))
    .slice(0, MAX_SLASH_ITEMS);
}

/**
 * Replaces the trailing token with `replacement`, preserving all lead text.
 * Guards the mid-flight-edit case web handles with a doc snapshot
 * (`slash-command-suggestion.tsx` command handler): if the text under `from`
 * no longer equals `/${query}`, the draft is returned untouched so a stale
 * render never clobbers newer text.
 */
export function replaceSlashTrigger(
  draft: string,
  from: number,
  query: string,
  replacement: string,
): string {
  const token = `/${query}`;
  if (draft.slice(from, from + token.length) !== token) return draft;
  return draft.slice(0, from) + replacement;
}