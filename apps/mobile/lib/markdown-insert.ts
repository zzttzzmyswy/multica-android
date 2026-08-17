/**
 * Selection-aware markdown syntax insertion for plain-text body inputs
 * (issue description, comment). Pure: `(text, selection, kind)` → the new
 * text + caret/selection, so callers just `setText` + `setSelection`.
 *
 * The three line-prefix kinds (`list` / `checkbox` / `quote`) anchor on the
 * line containing `selection.start` — the nearest `\n` before the anchor —
 * and are idempotent: an already-prefixed line never gets a second prefix
 * (a `- ` line won't become `- > ` by tapping quote, etc.). A non-empty
 * selection is preserved, shifted right by the inserted prefix so the
 * region the user highlighted stays highlighted.
 *
 * `code` replaces the selection (or the caret's spot) with a fenced
 * block ```` ```\n\n``` ```` and parks the caret on the empty middle line.
 */
export type MarkdownInsertKind = "list" | "checkbox" | "quote" | "code";

export interface TextSelection {
  start: number;
  end: number;
}

const LIST_PREFIX = "- ";
const CHECKBOX_PREFIX = "- [ ] ";
const QUOTE_PREFIX = "> ";
// Any line already carrying one of these is considered "formatting already
// applied" — tapping list / checkbox / quote on it is a no-op.
const LINE_PREFIXES = [CHECKBOX_PREFIX, LIST_PREFIX, QUOTE_PREFIX];

const PREFIX_BY_KIND: Record<"list" | "checkbox" | "quote", string> = {
  list: LIST_PREFIX,
  checkbox: CHECKBOX_PREFIX,
  quote: QUOTE_PREFIX,
};

const CODE_FENCE = "```\n\n```";
// Caret landing offset inside CODE_FENCE: start of the empty middle line.
const CODE_CURSOR_OFFSET = 4;

/** Start of the anchor line, or `null` when that line already carries a
 *  line-format prefix (idempotency bail-out). */
function lineStartWithPrefix(
  text: string,
  selection: TextSelection,
): number | null {
  const lineStart =
    selection.start > 0 ? text.lastIndexOf("\n", selection.start - 1) + 1 : 0;
  const rest = text.slice(lineStart);
  if (LINE_PREFIXES.some((p) => rest.startsWith(p))) return null;
  return lineStart;
}

export function insertMarkdown(
  text: string,
  selection: TextSelection,
  kind: MarkdownInsertKind,
): { text: string; selection: TextSelection } {
  if (kind === "code") {
    const { start, end } = selection;
    const next = text.slice(0, start) + CODE_FENCE + text.slice(end);
    const cursor = start + CODE_CURSOR_OFFSET;
    return { text: next, selection: { start: cursor, end: cursor } };
  }

  const prefix = PREFIX_BY_KIND[kind];
  const lineStart = lineStartWithPrefix(text, selection);
  if (lineStart === null) {
    // No-op — same references so the caller's setState bails out.
    return { text, selection };
  }

  const next = text.slice(0, lineStart) + prefix + text.slice(lineStart);
  return {
    text: next,
    selection: {
      start: selection.start + prefix.length,
      end: selection.end + prefix.length,
    },
  };
}