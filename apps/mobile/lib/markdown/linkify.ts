/**
 * Link detection — the DETECTION half of `packages/ui/markdown/linkify.ts`,
 * mirrored for mobile.
 *
 * Why a mirror and not an import: `packages/ui` is not on mobile's import
 * surface (React DOM, react-markdown, Tailwind). `lib/entity-link.ts:55-57`
 * already records the same decision for another shared helper. Mobile follows
 * the house rule for such cases — mirror the logic and pin it with tests — and
 * this docblock is the correspondence map back to upstream.
 *
 * What is mirrored VERBATIM (same regexes, same ordering, same boundary
 * handling), because a divergence here would silently change which spans
 * `lib/markdown/issue-identifiers.ts` treats as prose:
 *
 *   - `findCodeRanges`      — fenced blocks, display/inline math, inline code
 *   - `isInsideCode`
 *   - `findMarkdownLinkRanges` — existing link / image spans (label + dest)
 *   - `rangesOverlap`
 *   - `detectLinks`         — URLs + emails through `linkify-it` (the same
 *                             library and the same product policy web uses),
 *                             plus `FILE_PATH_REGEX` for absolute paths
 *   - `shouldAutoLink`      — the shared product policy: only http(s), `www.`
 *                             and email auto-link, so `plan.md` in prose is
 *                             never mistaken for a website
 *   - `CJK_URL_TERMINATOR_REGEX` / `TRAILING_MD_DELIMITER` — the two boundary
 *                             corrections that decide where a URL ENDS, and
 *                             therefore whether a trailing token sits inside
 *                             one or after it
 *
 * What is deliberately NOT mirrored: `preprocessLinks` / `hasLinks` /
 * `isAlreadyLinked`. Those turn bare URLs into markdown links, and mobile does
 * not do that — enriched-markdown autolinks prose itself, and the only URL
 * rewriting mobile performs is the narrower in-app entity pass in
 * `lib/markdown/preprocess.ts`. Omitting them keeps a second, competing
 * linkifier out of the mobile pipeline.
 *
 * PURE — no React, no native modules, no network. That is what lets the
 * identifier pass share these ranges in the Node vitest lane.
 */
import LinkifyIt from "linkify-it";

// Keep fuzzy detection enabled so linkify-it can recognize `www.` URLs.
// `shouldAutoLink` applies the stricter shared product policy below.
const linkify = new LinkifyIt();

// Common source/config file extensions used by the file-path detector.
const FILE_EXTENSIONS =
  "ts|tsx|js|jsx|mjs|cjs|md|json|yaml|yml|py|go|rs|css|scss|less|html|htm|txt|log|sh|bash|zsh|swift|kt|java|c|cpp|h|hpp|rb|php|xml|toml|ini|cfg|conf|env|sql|graphql|vue|svelte|astro|prisma|dockerfile|makefile|gitignore";

// File path regex - detects /path, ~/path, ./path with common extensions.
// Matches paths that start with /, ~/, or ./ followed by path chars and a
// file extension.
const FILE_PATH_REGEX = new RegExp(
  `(?:^|[\\s([{<])((\\/|~\\/|\\.\\/)[\\w\\-./@]+\\.(?:${FILE_EXTENSIONS}))(?=[\\s)\\]}.,;:!?>]|$)`,
  "gi",
);

// CJK full-width punctuation that should terminate a URL. linkify-it only
// treats ASCII punctuation as URL boundaries, so in Chinese / Japanese text a
// URL followed by e.g. "。" gets the punctuation and every character up to the
// next whitespace swallowed into the href. We truncate the detected URL at the
// first occurrence of any of these characters. Character set mirrors the fix
// applied in mattermost/marked#22.
const CJK_URL_TERMINATOR_REGEX = /[！-／：-＠［-｀｛-～、。「-】]/;

// Markdown inline-formatting delimiters that linkify-it counts as URL
// characters but which, at the very end of a bare URL, are almost always the
// author closing an emphasis / strikethrough span (`**url**`, `*url*`,
// `~~url~~`) rather than part of the URL. We drop a trailing run of them so the
// surrounding markdown still parses — mirroring GFM's own autolink
// trailing-punctuation trim (MUL-4242).
const TRAILING_MD_DELIMITER = /[*~]+$/;

interface DetectedLink {
  type: "url" | "email" | "file";
  text: string;
  url: string;
  start: number;
  end: number;
}

export interface CodeRange {
  start: number;
  end: number;
}

/**
 * Product policy for automatic external links.
 *
 * Detectors call this only after validating a candidate. This function decides
 * which validated text forms are safe to turn into a link without an explicit
 * user action: HTTP(S) URLs, `www.` URLs, and email addresses. In particular,
 * all other scheme-less domains stay plain text, which also prevents filenames
 * such as `plan.md` from being mistaken for websites.
 *
 * Keep this predicate shared by the editor and markdown renderer so typing,
 * paste, and read-only display cannot drift again.
 */
export function shouldAutoLink(value: string): boolean {
  return (
    /^https?:\/\//i.test(value) ||
    /^www\./i.test(value) ||
    /^[^\s@/:]+@[^\s@/:]+\.[^\s@/:]+$/.test(value)
  );
}

/**
 * Find all code block and inline code ranges in text.
 * These ranges should be excluded from link detection.
 */
export function findCodeRanges(text: string): CodeRange[] {
  const ranges: CodeRange[] = [];

  // Find fenced code blocks (```...```)
  const fencedRegex = /```[\s\S]*?```/g;
  let match;
  while ((match = fencedRegex.exec(text)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }

  // Find display math blocks ($$...$$)
  const displayMathRegex = /\$\$[\s\S]*?\$\$/g;
  while ((match = displayMathRegex.exec(text)) !== null) {
    const pos = match.index;
    const insideOther = ranges.some((r) => pos >= r.start && pos < r.end);
    if (!insideOther) {
      ranges.push({ start: pos, end: pos + match[0].length });
    }
  }

  // Find inline math ($...$)
  const inlineMathRegex = /(?<!\$)\$(?!\$)([^$\n]+)\$(?!\$)/g;
  while ((match = inlineMathRegex.exec(text)) !== null) {
    const pos = match.index;
    const insideOther = ranges.some((r) => pos >= r.start && pos < r.end);
    if (!insideOther) {
      ranges.push({ start: pos, end: pos + match[0].length });
    }
  }

  // Find inline code (`...`)
  // But skip escaped backticks and code inside fenced blocks
  const inlineRegex = /(?<!`)`(?!`)([^`\n]+)`(?!`)/g;
  while ((match = inlineRegex.exec(text)) !== null) {
    const pos = match.index;
    // Check if this is inside a fenced block or math block
    const insideOther = ranges.some((r) => pos >= r.start && pos < r.end);
    if (!insideOther) {
      ranges.push({ start: pos, end: pos + match[0].length });
    }
  }

  return ranges;
}

/**
 * Check if a position is inside any code range.
 */
export function isInsideCode(pos: number, ranges: CodeRange[]): boolean {
  return ranges.some((r) => pos >= r.start && pos < r.end);
}

function isEscaped(text: string, index: number): boolean {
  let slashCount = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) {
    slashCount++;
  }
  return slashCount % 2 === 1;
}

function findMatchingBracket(text: string, openIndex: number): number {
  let depth = 0;

  for (let i = openIndex; i < text.length; i++) {
    if (isEscaped(text, i)) continue;

    const char = text[i];
    if (char === "[") {
      depth++;
    } else if (char === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function findInlineLinkEnd(text: string, openParenIndex: number): number {
  let depth = 0;

  for (let i = openParenIndex; i < text.length; i++) {
    if (isEscaped(text, i)) continue;

    const char = text[i];
    if (char === "(") {
      depth++;
    } else if (char === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }

  return -1;
}

/**
 * Find existing markdown link/image spans so auto-linkification does not create
 * nested links inside their labels or destinations.
 */
export function findMarkdownLinkRanges(text: string): CodeRange[] {
  const ranges: CodeRange[] = [];

  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "[" || isEscaped(text, i)) continue;
    if (ranges.some((r) => i >= r.start && i < r.end)) continue;

    const labelEnd = findMatchingBracket(text, i);
    if (labelEnd === -1) continue;

    const start =
      i > 0 && text[i - 1] === "!" && !isEscaped(text, i - 1) ? i - 1 : i;
    const nextChar = text[labelEnd + 1];

    if (nextChar === "(") {
      const end = findInlineLinkEnd(text, labelEnd + 1);
      if (end !== -1) {
        ranges.push({ start, end });
        i = end - 1;
      }
      continue;
    }

    if (nextChar === "[") {
      const referenceEnd = findMatchingBracket(text, labelEnd + 1);
      if (referenceEnd !== -1) {
        ranges.push({ start, end: referenceEnd + 1 });
        i = referenceEnd;
      }
    }
  }

  return ranges;
}

/**
 * Check if ranges overlap.
 */
export function rangesOverlap(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Run linkify-it on `text` and push normalized link records into `out`,
 * shifted by `offset`. Two boundary corrections linkify-it doesn't make itself:
 * - CJK punctuation ends a URL (linkify-it only breaks on ASCII); when it merged
 *   several URLs across CJK punctuation we truncate and re-scan the tail; and
 * - a trailing run of markdown delimiters (`*`, `~`) is dropped from the URL so
 *   `**url**` keeps its closing emphasis marker outside the link.
 */
function collectLinkifyMatches(
  text: string,
  offset: number,
  out: DetectedLink[],
): void {
  const matches = linkify.match(text);
  if (!matches) return;

  for (const match of matches) {
    const cjkIdx = match.text.search(CJK_URL_TERMINATOR_REGEX);
    if (cjkIdx === 0) continue; // match starts with CJK punct — skip

    const truncate = cjkIdx > 0;
    // URL text up to the first CJK terminator, then minus a trailing markdown
    // delimiter run (e.g. the closing `**` of `**url**`). matchText stays a
    // prefix of match.text, so the link end is just its length past match.index.
    const matchText = (truncate
      ? match.text.slice(0, cjkIdx)
      : match.text
    ).replace(TRAILING_MD_DELIMITER, "");

    if (matchText.length > 0 && shouldAutoLink(matchText)) {
      // When we trimmed the raw match, rebuild the href from the scheme prefix
      // linkify-it added (e.g. "http://" / "mailto:") plus the trimmed text;
      // otherwise keep linkify-it's normalized url as-is.
      const trimmed = matchText.length !== match.text.length;
      const schemePrefix = match.url.slice(
        0,
        match.url.length - match.text.length,
      );
      const matchUrl =
        match.schema === "" && /^www\./i.test(matchText)
          ? `https://${matchText}`
          : trimmed
            ? schemePrefix + matchText
            : match.url;

      out.push({
        type: match.schema === "mailto:" ? "email" : "url",
        text: matchText,
        url: matchUrl,
        start: match.index + offset,
        end: match.index + matchText.length + offset,
      });
    }

    if (truncate) {
      // Rescan the tail after the CJK punct — linkify-it had greedily swallowed
      // it, so any additional URLs after the punct were never emitted.
      const tailStart = match.index + cjkIdx + 1;
      collectLinkifyMatches(text.slice(tailStart), offset + tailStart, out);
      return;
    }
  }
}

/**
 * Detect all links (URLs, emails, file paths) in text.
 */
export function detectLinks(text: string): DetectedLink[] {
  const links: DetectedLink[] = [];

  // 1. Detect URLs and emails with linkify-it, applying boundary corrections.
  collectLinkifyMatches(text, 0, links);

  // 2. Detect file paths with custom regex
  // Reset regex state
  FILE_PATH_REGEX.lastIndex = 0;
  let fileMatch;
  while ((fileMatch = FILE_PATH_REGEX.exec(text)) !== null) {
    const path = fileMatch[1];
    if (!path) continue; // Skip if no capture group

    // Calculate actual start position (after any leading whitespace/punctuation)
    const fullMatch = fileMatch[0];
    const pathOffset = fullMatch.indexOf(path);
    const start = fileMatch.index + pathOffset;

    // Check for overlaps with URL matches (URLs take precedence)
    const pathRange = { start, end: start + path.length };
    const overlapsUrl = links.some((link) => rangesOverlap(pathRange, link));
    if (overlapsUrl) continue;

    links.push({
      type: "file",
      text: path,
      url: path, // File paths are passed as-is to onFileClick handler
      start,
      end: start + path.length,
    });
  }

  // Sort by position
  return links.sort((a, b) => a.start - b.start);
}
