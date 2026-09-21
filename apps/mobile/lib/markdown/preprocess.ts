/**
 * Pure string transforms applied before marked.lexer parses the content.
 *
 * Two passes, both idempotent:
 *   1. Legacy mention shortcodes `[@ id="..." label="..."]` → modern
 *      mention link `[@Label](mention://member/id)`. Old DB rows from before
 *      the April 2026 migration use the shortcode form; the modern form is
 *      what marked.js can naturally tokenize as a markdown link. Calls into
 *      `@multica/core/markdown` (single source of truth — same regex web/
 *      desktop run).
 *
 *   2. File card lines `!file[name](url)` → standard link `[📎 name](url)`.
 *      marked.js doesn't recognize the `!file` prefix; web's preprocess
 *      turns it into HTML, which mobile can't render natively. Rewriting
 *      to a normal link with a 📎 emoji makes it a tappable link that
 *      `Linking.openURL` opens in the system viewer (Safari for PDFs,
 *      QuickLook for docs, share sheet for arbitrary files).
 *
 * NOTE: Web's preprocess also has a third pass that detects bare CDN
 * URLs as legacy file links. We skip that because mobile doesn't bootstrap
 * the cdnDomain config. Old comments using the legacy form render as plain
 * hyperlinks — same tap behavior, just no 📎 prefix. Acceptable degradation.
 */
import { preprocessMentionShortcodes } from "@multica/core/markdown";
import {
  isIssueIdentifier,
  parseUnfurlableEntityLink,
} from "@/lib/entity-link";

// File-card line matcher, kept in sync with web's parser in
// `packages/ui/markdown/file-cards.ts` (NEW_FILE_CARD_RE + FILE_CARD_URL_PATTERN):
//
//   - Label allows backslash-escaped metacharacters (`\[ \] \\ \( \)`) so a
//     filename like `a]b.pdf` — which the CLI escapes to `a\]b.pdf` in its
//     `!file[...]` output (see cmd_attachment.go escapeMarkdownLabel) — is
//     captured whole. Backslash is excluded from the negated class so
//     overlapping alternatives can't backtrack (ReDoS, web #4881).
//   - URL is restricted to the same allowlist web accepts: site-relative
//     `/uploads/...` and `/api/attachments/<UUID>/download`, plus absolute
//     `http(s)://`. Anything else (`javascript:`, `data:`, `//host`, other
//     `/api/…`) is left as plain text so a stored card can't become an
//     out-of-band navigation.
const ATTACHMENT_UUID =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const FILE_CARD_URL = `/uploads/[^)]*|https?://[^)]+|/api/attachments/${ATTACHMENT_UUID}/download`;
const FILE_LINE_RE = new RegExp(
  `^!file\\[((?:\\\\.|[^\\]\\\\])*)\\]\\((${FILE_CARD_URL})\\)$`,
);

// Unescape the file-card label back to the real filename (mirrors web's
// `newMatch[1].replace(/\\([[\]\\()])/g, "$1")`).
function unescapeFileLabel(label: string): string {
  return label.replace(/\\([[\]\\()])/g, "$1");
}

// Re-escape only the characters that would break a markdown LINK label, so the
// emitted `[📎 name](url)` stays valid markdown. Mobile's target is a link
// (re-parsed by marked / the enriched renderer), unlike web's HTML
// `data-filename` attribute — so a raw `]` must not truncate the link text.
function escapeLinkLabel(name: string): string {
  return name.replace(/([\\[\]])/g, "\\$1");
}

function preprocessFileCards(input: string): string {
  return input
    .split("\n")
    .map((line) => {
      const m = line.trim().match(FILE_LINE_RE);
      if (!m) return line;
      const label = escapeLinkLabel(unescapeFileLabel(m[1]!));
      return `[📎 ${label}](${m[2]})`;
    })
    .join("\n");
}

/**
 * Add GFM strikethrough markers around the content of checked task list items
 * so they render with `~~text~~` styling — matching Linear / Notion / Apple
 * Reminders / Things 3, where a checked item is visually crossed out.
 *
 * GFM itself does not specify that checked items SHOULD be struck through;
 * enriched-markdown's task-list renderer only changes the checkbox glyph and
 * (via `checkedTextColor`) dims the text. Without the strikethrough the
 * "done" state reads weakly, and users who expect the platform pattern from
 * other task apps assume the checkbox didn't take effect.
 *
 * Idempotent: skips lines whose body is already wrapped in `~~ ... ~~`.
 * Conservative regex — only matches `- [x]` / `* [x]` / `+ [x]` at the start
 * of a line (allowing leading whitespace), case-insensitive on the `x`.
 */
const TASK_DONE_RE = /^(\s*[-*+]\s+\[[xX]\]\s+)(.+)$/gm;

function preprocessTaskListStrikethrough(input: string): string {
  return input.replace(TASK_DONE_RE, (match, prefix, body) => {
    const trimmed = body.trim();
    if (trimmed.startsWith("~~") && trimmed.endsWith("~~")) return match;
    return `${prefix}~~${body}~~`;
  });
}

/**
 * Strip embedded HTML before marked sees it. Mobile cannot do what web does
 * (rehype-raw + sanitize → render real <br> / <sub> / <details>) — RN has
 * no inline HTML. Without this pass, users see literal `<br>` tags in the
 * comment body. Strategy:
 *
 *   - `<br>` / `<br/>` / `<br />` → `"  \n"` (two trailing spaces + newline,
 *     the canonical CommonMark hard-break syntax). md4c respects it as a
 *     hard line break inside a paragraph; bare `\n` would be treated as a
 *     space (CommonMark default), losing intentional `<br>` semantics.
 *   - HTML comments `<!-- ... -->` → removed entirely.
 *   - Every other tag → strip the tag, keep the inner text. So
 *     `<sub>2</sub>` becomes `2`. Loses formatting but keeps content; far
 *     better than showing raw HTML.
 *
 * IMPORTANT: applied to *prose* only, after `splitMarkdown` has carved the
 * fenced code blocks out (see markdown.tsx). It must NOT run over the whole
 * document up front — that would shred the HTML body inside ` ```html `
 * blocks, which render through the rich HtmlBlockPreview instead.
 *
 * Does not parse — pure regex. Cannot handle nested tags with attributes
 * containing `>`, but those don't appear in our editor output.
 */
export function stripHtml(input: string): string {
  return input
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "  \n")
    .replace(/<\/?[a-z][^>]*>/gi, "");
}

/**
 * Rewrite a bare link to an issue/project ON THIS DEPLOYMENT into the
 * `mention://` transport, so the existing mention handling routes it in-app
 * instead of handing it to the system browser (iteration 173, R1).
 *
 * Mirrors web's `unfurlableEntityLink` gate (`rich-content.tsx:193`): only a
 * link whose LABEL is the href itself is unfurled — `[see this issue](url)`
 * is prose the author wrote and keeps its label — and only for the current
 * workspace, because a chip resolves its title against the workspace the
 * viewer is in.
 *
 * The id form is restricted to UUIDs. `mention://issue/MUL-123` would route
 * to the issue detail page, which resolves a UUID only, so an identifier link
 * is left as an ordinary link rather than turned into a dead in-app jump.
 * (Web resolves identifiers against the workspace first; mobile has no such
 * lookup in the render path.)
 */
const MD_LINK_RE = /(?<!!)\[([^\]]*)\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g;

/**
 * A BARE url in prose — no `[label](url)` around it.
 *
 * This is the shape that actually reaches us: "Copy link" puts a URL on the
 * clipboard and people paste it as-is, so the markdown has no link syntax at
 * all and the renderer autolinks it afterwards. Matching only the `[label]`
 * form (as the first cut of this pass did) left the common case opening the
 * system browser — verified on-device before this branch was added.
 *
 * Deliberately does NOT try to find the end of a URL the way a linkifier does.
 * The candidate must be followed by whitespace or end-of-line, and the trailing
 * run of sentence punctuation is trimmed; anything more ambitious is a
 * re-implementation of the linkifier, and `parseWorkspaceEntityLink` already
 * rejects whatever does not address exactly one entity.
 */
const BARE_URL_RE = /https?:\/\/[^\s<>()\[\]"']+/g;

/** Punctuation that ends a sentence rather than a URL. */
const TRAILING_PUNCT_RE = /[.,;:!?、。，；：！？）】》”’]+$/;

/**
 * True when the URL starting at `index` is already part of a markdown link or
 * image — `](url)`, `[label](url)`, `![alt](url)`.
 *
 * The bare pass runs over the WHOLE document, including the constructs the
 * markdown pass just rewrote, so without this it would wrap the href of an
 * already-rewritten link in a second link. That produced literal
 * `[[url](mention://…)](mention://…)` nesting — caught by the tests below.
 */
function insideMarkdownLink(input: string, index: number): boolean {
  const before = input[index - 1];
  if (before === "[" || before === "!") return true;
  if (before === "(" && input[index - 2] === "]") return true;
  return false;
}

function preprocessEntityLinks(
  input: string,
  appOrigin: string | null,
  currentSlug: string | null,
): string {
  if (!appOrigin) return input;

  const opts = { appOrigin, currentSlug };
  // Markdown-link form first: `[label](url)`.
  const withLinks = input.replace(
    MD_LINK_RE,
    (match, label: string, href: string) => {
      const entity = parseUnfurlableEntityLink({ href, label, ...opts });
      if (!entity || isIssueIdentifier(entity.id)) return match;
      return `[${label}](mention://${entity.kind}/${entity.id})`;
    },
  );

  // Then the bare form, skipping anything the pass above (or the author)
  // already put inside a link. Rebuilt by hand rather than with a replacement
  // function because the decision needs the match's POSITION.
  let out = "";
  let last = 0;
  BARE_URL_RE.lastIndex = 0;
  for (const m of withLinks.matchAll(BARE_URL_RE)) {
    const start = m.index ?? 0;
    if (insideMarkdownLink(withLinks, start)) continue;

    const raw = m[0];
    const trailing = raw.match(TRAILING_PUNCT_RE)?.[0] ?? "";
    const href = trailing ? raw.slice(0, -trailing.length) : raw;
    const entity = parseUnfurlableEntityLink({
      href,
      // A bare URL's visible text IS the URL — the same gate web applies, and
      // the reason a bare URL qualifies where `[the bug](url)` does not.
      label: href,
      ...opts,
    });
    if (!entity || isIssueIdentifier(entity.id)) continue;

    out += withLinks.slice(last, start);
    out += `[${href}](mention://${entity.kind}/${entity.id})${trailing}`;
    last = start + raw.length;
  }
  return out + withLinks.slice(last);
}

export function preprocessMobileMarkdown(
  input: string,
  options?: {
    /** This deployment's app origin — links to it become in-app chips.
     *  Omitted (or empty) leaves every link untouched. */
    appOrigin?: string | null;
    /** The workspace the reader is in, for the cross-workspace guard. */
    currentSlug?: string | null;
  },
): string {
  if (!input) return "";
  return preprocessTaskListStrikethrough(
    preprocessFileCards(
      preprocessEntityLinks(
        preprocessMentionShortcodes(input),
        options?.appOrigin ?? null,
        options?.currentSlug ?? null,
      ),
    ),
  );
}
