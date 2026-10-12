/**
 * Drift ratchet for the linkify mirror (iteration 233, MYS-2110).
 *
 * `apps/mobile/lib/markdown/linkify.ts` is a MIRROR of
 * `packages/ui/markdown/linkify.ts` — `packages/ui` is not on mobile's import
 * surface, so the logic was copied rather than imported (the same call
 * `lib/entity-link.ts` records for `isIssueIdentifier`). A mirror that silently
 * drifts is worse than a shared import, because nothing fails: the two clients
 * would simply start disagreeing about which spans are prose.
 *
 * This pins the parts that must not drift — the detectors' REGEXES and the
 * numeric/list constants that decide boundaries. Formatting (quotes, semicolons)
 * is normalised away deliberately: this ratchet is about behaviour, not style,
 * and a style-sensitive version would fail on every formatter run and get
 * deleted.
 *
 * When upstream legitimately changes, update both files and this list together
 * — that is the point.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// This file lives at `apps/mobile/lib/markdown/`, so four levels up is the
// repo root (`markdown` → `lib` → `mobile` → `apps` → root).
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const UPSTREAM = path.join(REPO_ROOT, "packages/ui/markdown/linkify.ts");
const MIRROR = path.join(__dirname, "linkify.ts");

/** Strip comments and normalise quote style / trailing semicolons so the
 *  comparison sees code shape rather than formatting. */
function normalize(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/"/g, "'")
    .replace(/;\s*$/gm, "")
    .replace(/\s+$/gm, "");
}

const upstream = normalize(readFileSync(UPSTREAM, "utf8"));
const mirror = normalize(readFileSync(MIRROR, "utf8"));

/** Every literal the mirror must carry unchanged. Each is a boundary decision:
 *  change one and the two clients stop agreeing about where a link ends, which
 *  in turn moves identifiers in and out of the "inside a URL" skip. */
const SHARED_LITERALS: Array<[string, string]> = [
  ["CJK terminator class", "/[！-／：-＠［-｀｛-～、。「-】]/"],
  ["trailing md delimiter", "/[*~]+$/"],
  ["file extensions", "dockerfile|makefile|gitignore"],
  // Inside the source's template literal these are DOUBLE backslashes:
  // `(\\/|~\\/|\\.\\/)`.
  ["file path prefixes", "~\\\\/|\\\\.\\\\/"],
  ["fenced code regex", "/```[\\s\\S]*?```/g"],
  ["display math regex", "/\\$\\$[\\s\\S]*?\\$\\$/g"],
  ["inline math regex", "/(?<!\\$)\\$(?!\\$)([^$\\n]+)\\$(?!\\$)/g"],
  ["inline code regex", "/(?<!`)`(?!`)([^`\\n]+)`(?!`)/g"],
];

describe("the mobile linkify mirror carries upstream's detectors", () => {
  for (const [label, literal] of SHARED_LITERALS) {
    it(`shares the ${label}`, () => {
      const normalizedLiteral = literal.replace(/"/g, "'");
      expect(upstream, `upstream no longer contains the ${label}`).toContain(
        normalizedLiteral,
      );
      expect(mirror, `mirror is missing the ${label}`).toContain(
        normalizedLiteral,
      );
    });
  }

  it("exports the same detection surface", () => {
    for (const name of [
      "shouldAutoLink",
      "findCodeRanges",
      "isInsideCode",
      "findMarkdownLinkRanges",
      "rangesOverlap",
      "detectLinks",
    ]) {
      expect(upstream, `upstream missing ${name}`).toContain(
        `export function ${name}`,
      );
      expect(mirror, `mirror missing ${name}`).toContain(
        `export function ${name}`,
      );
    }
  });

  it("does NOT mirror the link-REWRITING half (mobile must not run a second linkifier)", () => {
    // `preprocessLinks` turns bare URLs into markdown links. Mobile does not do
    // that — enriched-markdown autolinks prose itself, and the only URL
    // rewriting mobile performs is the narrower in-app entity pass. Mirroring
    // it would put two competing linkifiers in one pipeline.
    expect(upstream).toContain("export function preprocessLinks");
    expect(mirror).not.toContain("export function preprocessLinks");
    expect(mirror).not.toContain("export function hasLinks");
  });

  it("uses the same library for URL detection, so boundaries cannot diverge", () => {
    expect(upstream).toContain("from 'linkify-it'");
    expect(mirror).toContain("from 'linkify-it'");
  });
});
