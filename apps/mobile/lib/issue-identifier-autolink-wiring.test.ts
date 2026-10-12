/**
 * Wiring ratchet for the read-only identifier autolink (iteration 233,
 * MYS-2110).
 *
 * `lib/markdown/issue-identifiers.test.ts` proves the rewrite rules and
 * `lib/markdown/preprocess.test.ts` proves the pass composes correctly. None of
 * that reaches a user unless the pieces are actually connected — which is the
 * failure this project keeps hitting: a correct helper with no caller, or a
 * caller that re-derives a decision the helper already owns.
 *
 * The assertions that matter most:
 *   - the pass must be wired ONLY into the read-only renderer. Wiring it into
 *     an editable path would put an identifier-shaped mention id into the
 *     markdown saved back to the server — web keeps the same pass off for
 *     Tiptap for exactly this reason;
 *   - the render path must pass RESOLVED identifiers, and the resolver must
 *     hand back the UUID. A link whose target is the identifier string reads
 *     the right issue once and then silently drops every realtime update, since
 *     `useIssueRealtime` self-gates on `payload.issue.id !== issueId`;
 *   - the resolver must consume `collectIssueIdentifiers` rather than scanning
 *     for identifiers itself, so the set it fetches is exactly the set the
 *     rewriter can act on.
 *
 * Mobile's vitest lane is Node-only, so this is asserted against source rather
 * than rendered markup. Comments are stripped so a comment describing the
 * wiring cannot satisfy it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const MARKDOWN = "lib/markdown/markdown.tsx";
const HOOK = "lib/use-issue-identifier-mentions.ts";
const PREPROCESS = "lib/markdown/preprocess.ts";
const ENTITY_LINK = "lib/entity-link.ts";

describe("the read-only renderer resolves and passes identifiers", () => {
  const src = code(MARKDOWN);

  it("resolves identifiers and hands them to the preprocessor", () => {
    expect(src).toContain("useResolvedIssueIdentifiers(content)");
    expect(src).toContain("resolvedIdentifiers");
  });

  it("re-runs the preprocess memo when the resolved set changes", () => {
    // Without this dependency the segments memo keeps the first (usually empty)
    // resolution and identifiers never become links.
    expect(src).toMatch(/\}, \[content, wsSlug, resolvedIdentifiers\]\)/);
  });

  it("routes the rewrite through the existing mention:// channel", () => {
    // No new navigation path, no new sentinel — the rewrite reuses the branch
    // that already maps issue/project explicitly.
    expect(src).toContain('url.startsWith("mention://")');
    expect(src).toContain("router.push(`/${wsSlug}/issue/${id}`)");
  });
});

describe("the resolver fetches exactly the candidates the rewriter can use", () => {
  const src = code(HOOK);

  it("consumes the shared candidate collector", () => {
    expect(src).toContain("collectIssueIdentifiers");
  });

  it("does not re-derive identifier candidates with its own regex", () => {
    // A second detector here would drift from the rewriter's skip rules: the
    // resolver would fetch identifiers inside code fences (wasted requests) or
    // miss ones the rewriter will act on (dead text).
    //
    // Assert on the CALL, not on the absence of a pattern literal: this file's
    // own docblock legitimately spells the identifier shape, so a regex-shape
    // scan is both fragile and unable to tell a real second detector from prose.
    expect(src).toContain("collectIssueIdentifiers(content)");
    expect(src).not.toMatch(/\.match\(/);
    expect(src).not.toMatch(/new RegExp\(/);
  });

  it("maps identifier to UUID, not to a boolean", () => {
    expect(src).toContain("result.data.id");
    expect(src).toContain("Map<string, string>");
  });

  it("keys the returned map on the resolved pairs, not on array identity", () => {
    // `useQueries` returns a fresh array every render; a map rebuilt on that
    // identity would invalidate the caller's memo on every render and re-run
    // preprocess (and this whole lookup) forever.
    expect(src).toContain("pairsKey");
    // The map memo depends on the serialized pairs, not on `results`.
    const mapMemo = src.slice(src.indexOf("return useMemo("));
    expect(mapMemo).toContain("[pairsKey]");
    expect(mapMemo).not.toContain("[results");
  });
});

describe("the identifier pass reaches the pipeline in web's order", () => {
  // Scope to the pipeline function: the helper DEFINITIONS appear earlier in
  // the file, so a whole-file indexOf would compare definition sites instead of
  // call order.
  const pipeline = code(PREPROCESS).slice(
    code(PREPROCESS).indexOf("export function preprocessMobileMarkdown"),
  );

  it("runs identifiers before the entity-link and file-card passes", () => {
    // Assert the DATA FLOW, not textual order: the passes nest inside-out
    // (`fileCards(entityLinks(identifiers(input)))`), so the callee text runs
    // outermost-first and an indexOf comparison would be backwards.
    //
    // Web's order: step 2 identifiers, step 3 links, step 4 file cards —
    // identifiers FIRST, so the later passes see the rewritten spans as
    // existing markdown links and skip them.
    expect(pipeline).toMatch(
      /const withIdentifiers = options\?\.resolvedIdentifiers[\s\S]*?preprocessIssueIdentifiers\(/,
    );
    expect(pipeline).toMatch(/preprocessEntityLinks\(\s*withIdentifiers,/);
    expect(pipeline).toMatch(
      /preprocessTaskListStrikethrough\(\s*preprocessFileCards\(\s*preprocessEntityLinks\(/,
    );
  });

  it("keeps the pass opt-in, defaulting to off", () => {
    expect(pipeline).toContain("options?.resolvedIdentifiers");
  });
});

describe("the editable paths are left alone", () => {
  const src = code(MARKDOWN);

  it("the renderer is the only Markdown surface that resolves identifiers", () => {
    // `markdown.tsx` is the read-only entry; the editable description field and
    // the composers render no `<Markdown>` at all. Assert the editor file does
    // not import the hook or the pass.
    const editor = code("components/issue/description-field.tsx");
    expect(editor).not.toContain("useResolvedIssueIdentifiers");
    expect(editor).not.toContain("resolvedIdentifiers");
    expect(src).toContain("useResolvedIssueIdentifiers");
  });
});

describe("isIssueIdentifier has exactly one definition on mobile", () => {
  it("the markdown pass re-exports the entity-link definition", () => {
    // A second copy of the pattern is how the two drift; the markdown pass
    // re-exports instead of minting its own.
    expect(code("lib/markdown/issue-identifiers.ts")).toContain(
      'from "@/lib/entity-link"',
    );
    expect(code(ENTITY_LINK)).toContain("ISSUE_IDENTIFIER_PATTERN");
  });
});
