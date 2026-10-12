/**
 * Bare issue identifier autolinking — mobile mirror of
 * `packages/ui/markdown/issue-identifiers.ts`.
 *
 * Rewrites bare identifiers like `MYS-2109` into canonical mention links
 * `[MYS-2109](mention://issue/MYS-2109)`, so the existing `mention://` branch
 * in `lib/markdown/markdown.tsx` routes them in-app instead of leaving them as
 * unclickable text.
 *
 * ## Why mobile carries its own copy
 *
 * `packages/ui` is not on mobile's import surface (React DOM, react-markdown,
 * Tailwind) — `lib/entity-link.ts:55-57` records the same decision for
 * `isIssueIdentifier`. Per the house rule for such helpers the logic is
 * MIRRORED and pinned by tests, not imported. Keep this file in step with
 * upstream; the skip list below is the whole contract.
 *
 * ## The two stale reasons this file replaces
 *
 * `lib/markdown/preprocess.ts` used to document that identifiers were left
 * alone because (a) the detail page resolves UUIDs only, so an identifier link
 * would be a dead jump, and (b) resolving one needs a workspace query mobile
 * had no place to run. Both were measured against this deployment and neither
 * holds:
 *
 *   - `GET /api/issues/MYS-2109` answers 200 with a body **byte-identical** to
 *     the UUID form of the same issue, and `…/timeline`, `…/comments`,
 *     `…/children` resolve by identifier too. Every mobile read path
 *     (`data/queries/issues.ts`) splices the route segment into the URL
 *     verbatim, so a detail page entered by identifier already reads
 *     correctly.
 *   - The volume is not marginal: 1,247 bare identifiers across this
 *     deployment's descriptions and comments, against only 12 structured
 *     `mention://issue/<uuid>` links. The 1% written as a link was tappable;
 *     the other 99% was not.
 *
 * ## What still needs a lookup, and why the target is the UUID
 *
 * The server 404s an identifier that names no issue. Detection is purely
 * syntactic — it cannot know what exists — so {@link preprocessIssueIdentifiers}
 * rewrites only the identifiers the caller has CONFIRMED. A candidate that
 * resolves to nothing stays plain text, which is exactly web's end state
 * (`IdentifierIssueMentionLink` renders `fallback`). Web reaches it by
 * resolving at RENDER time; mobile has no custom inline renderer to fall back
 * from (react-native-enriched-markdown exposes no leaf hook), so it must
 * decide before the string reaches md4c.
 *
 * The resolved UUID — not the identifier — becomes the link target. The
 * `mention://` handler pushes the id segment straight into the route, and the
 * detail/timeline cache keys and `useIssueRealtime`'s `payload.issue.id !==
 * issueId` gating are all keyed on the UUID; an identifier path would read the
 * right issue once and then drop every realtime update for it.
 *
 * ## Where it must and must not run
 *
 * Web opens this pass for the READ-ONLY renderer only (`rich-content.tsx:523`)
 * and keeps it off the editable Tiptap path, because there the rewrite becomes
 * a mention node whose id is the identifier string rather than a real UUID and
 * corrupts the markdown saved back to the server. Mobile stores the editor's
 * own text verbatim, so the same asymmetry applies and the only wiring point is
 * the read-only memo in `markdown.tsx` — never `description-field.tsx` or a
 * composer.
 */
import {
  detectLinks,
  findCodeRanges,
  findMarkdownLinkRanges,
  isInsideCode,
  rangesOverlap,
  type CodeRange,
} from "./linkify";
import {
  ISSUE_IDENTIFIER_PATTERN,
  isIssueIdentifier,
} from "@/lib/entity-link";

export { ISSUE_IDENTIFIER_PATTERN, isIssueIdentifier };

/**
 * Detection form (global). Prefix is one uppercase letter followed by uppercase
 * alphanumerics, then `-<number>`. Case-sensitive on purpose: lowercase
 * `abc-1` in prose is almost never an issue reference, and matching it would
 * linkify ordinary hyphenated words. The look-around excludes alphanumerics,
 * `_`, and `-` on both sides so we only match standalone tokens.
 */
const IDENTIFIER_RE = /(?<![A-Za-z0-9_-])([A-Z][A-Z0-9]*-\d+)(?![A-Za-z0-9_-])/g;

/** Cheap early-out: no `<UPPER>…-<DIGIT>` shape at all. */
const HAS_IDENTIFIER_SHAPE = /[A-Z][A-Z0-9]*-\d/;

/**
 * Every identifier occurrence in `text` that survives the skip rules, in
 * document order, as `[start, end)` offsets into `text`.
 *
 * ONE walker behind both public functions. They must agree on what counts as a
 * rewritable identifier — `collectIssueIdentifiers` decides which identifiers
 * the caller spends a request on, and it would be a silent bug for the resolver
 * to confirm (or skip) a different set than the rewriter acts on.
 *
 * Skipped contexts, each measured against this deployment's real content
 * (25 live issues: 271 identifiers in plain prose against 4 inside inline code,
 * 1 inside a markdown link, 4 with a dotted continuation and 2 in path
 * segments — a rewrite ignoring the rules would corrupt real content to serve
 * the prose majority):
 *
 *   - fenced code blocks, inline code, and math (`findCodeRanges`)
 *   - existing markdown links / images, label or destination
 *     (`findMarkdownLinkRanges`)
 *   - detected URLs / emails / file paths (`detectLinks`)
 *   - dotted continuations like `ABC-123.ts`, `ABC-123.tar.gz`
 *   - path segments like `FOO-1/bar` or `foo/BAR-1`
 *   - a left-hand dotted name like `file.MUL-1`
 */
function scanIdentifierRanges(text: string): Array<[number, number]> {
  if (!HAS_IDENTIFIER_SHAPE.test(text)) return [];

  const codeRanges: CodeRange[] = findCodeRanges(text);
  const linkRanges = findMarkdownLinkRanges(text);
  const detectedLinks = detectLinks(text);

  const out: Array<[number, number]> = [];
  IDENTIFIER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = IDENTIFIER_RE.exec(text)) !== null) {
    const identifier = match[1];
    if (!identifier) continue;
    const start = match.index;
    const end = start + identifier.length;
    const range = { start, end };

    // Inside fenced/inline code or math.
    if (isInsideCode(start, codeRanges)) continue;
    // Inside an existing markdown link/image (label OR destination).
    if (linkRanges.some((r) => rangesOverlap(range, r))) continue;
    // Inside a detected URL / email / file path.
    if (detectedLinks.some((l) => rangesOverlap(range, l))) continue;

    // Dotted continuation such as `ABC-123.ts` (filename) or `ABC-123.tar.gz`:
    // a `.` immediately followed by an alphanumeric means the token is part of
    // a larger dotted name. A trailing `.` before whitespace/EOL is a sentence
    // end ("see MYS-1.") and stays linkable.
    const after = text[end];
    if (after === "." && /[A-Za-z0-9]/.test(text[end + 1] ?? "")) continue;
    // Path segment such as `FOO-1/bar` or `foo/BAR-1` — a `/` on either side
    // signals a path rather than a standalone reference.
    if (after === "/" || text[start - 1] === "/") continue;
    // Embedded in a dotted name on the left (`file.MUL-1`).
    if (text[start - 1] === ".") continue;

    out.push([start, end]);
  }

  return out;
}

/**
 * A lookup of identifiers the caller has confirmed name a real issue in the
 * current workspace, mapped to that issue's UUID.
 *
 * Maps to the UUID rather than merely answering "yes" because the link's
 * TARGET must be the UUID, not the identifier. `markdown.tsx`'s `mention://`
 * branch pushes `/<slug>/issue/<id>` verbatim, and everything downstream —
 * the detail/timeline cache keys, and `useIssueRealtime`'s
 * `payload.issue.id !== issueId` self-gating — is keyed on the issue UUID.
 * Navigating with an identifier would read the right issue once and then
 * silently drop every realtime update for it. This is also what web does: its
 * `IdentifierIssueMentionLink` resolves first and hands `issue.id` to
 * `IssueMentionLink`, keeping the identifier only as the visible label.
 */
export interface ResolvedIdentifiers {
  get(identifier: string): string | undefined;
}

/**
 * Rewrite bare issue identifiers into canonical mention links, keeping the
 * identifier as the visible label and the resolved UUID as the target:
 * `[MYS-2109](mention://issue/<uuid>)`.
 *
 * Runs BEFORE the entity-link and file-card passes so those see the rewritten
 * spans as existing markdown links and skip them — the same ordering web uses
 * (`packages/views/editor/utils/preprocess.ts`, step 2 before step 3).
 *
 * `resolved` is REQUIRED rather than optional so this cannot be wired up
 * optimistically by mistake: the server 404s an identifier that names no
 * issue, so rewriting an unconfirmed candidate would turn an innocuous string
 * into a tappable link to an error page. A candidate absent from `resolved`
 * stays exactly the plain text the author typed — web's end state too, whose
 * `IdentifierIssueMentionLink` renders `fallback` on a miss.
 */
export function preprocessIssueIdentifiers(
  text: string,
  resolved: ResolvedIdentifiers,
): string {
  const ranges = scanIdentifierRanges(text);
  if (ranges.length === 0) return text;

  let result = "";
  let lastIndex = 0;
  for (const [start, end] of ranges) {
    const identifier = text.slice(start, end);
    const issueId = resolved.get(identifier);
    if (!issueId) continue;

    result += text.slice(lastIndex, start);
    result += `[${identifier}](mention://issue/${issueId})`;
    lastIndex = end;
  }

  if (lastIndex === 0) return text;
  return result + text.slice(lastIndex);
}

/**
 * Every DISTINCT bare identifier in `text`, in first-appearance order — the
 * candidate set a caller hands to the resolver.
 *
 * Shares {@link scanIdentifierRanges} with the rewriter, so the resolver never
 * spends a request on an identifier the rewriter deliberately left as plain
 * text (a `MUL-1` inside a code fence is not a link, so it must not cost a
 * lookup).
 */
export function collectIssueIdentifiers(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const [start, end] of scanIdentifierRanges(text)) {
    const identifier = text.slice(start, end);
    if (seen.has(identifier)) continue;
    seen.add(identifier);
    out.push(identifier);
  }
  return out;
}
