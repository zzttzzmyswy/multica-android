import { describe, expect, it } from "vitest";
import {
  collectIssueIdentifiers,
  isIssueIdentifier,
  preprocessIssueIdentifiers,
} from "./issue-identifiers";

const UUID = "01a12e65-9ed5-7e40-a2f1-363fdea817bc";

/** A resolver answering only for the identifiers a test declares as real —
 *  the same shape the render path passes (`issueIdentifierOptions` →
 *  `useResolvedIssueIdentifiers`). Keys are the EXISTING identifiers. */
function resolver(existing: Record<string, string>) {
  const map = new Map(Object.entries(existing));
  return { get: (identifier: string) => map.get(identifier) };
}

/** The common case: every candidate exists. */
const allExist = { get: (identifier: string) => `uuid-for-${identifier}` };

/**
 * Detection + rewrite rules, mirroring web's suite
 * (`packages/views/editor/utils/issue-identifiers.test.ts`) case for case, so
 * the two clients cannot drift on what counts as a bare identifier. The
 * `resolved` argument is the one deliberate difference — see the module
 * docblock — and it is exercised separately below.
 */
describe("preprocessIssueIdentifiers", () => {
  it("rewrites a bare identifier into a mention link", () => {
    expect(preprocessIssueIdentifiers("Related to MYS-2109", allExist)).toBe(
      "Related to [MYS-2109](mention://issue/uuid-for-MYS-2109)",
    );
  });

  it("rewrites multiple identifiers in one string", () => {
    expect(preprocessIssueIdentifiers("Created TES-1 and MUL-2", allExist)).toBe(
      "Created [TES-1](mention://issue/uuid-for-TES-1) and [MUL-2](mention://issue/uuid-for-MUL-2)",
    );
  });

  it("links an identifier at a sentence end (trailing dot + space)", () => {
    expect(preprocessIssueIdentifiers("See MYS-1. Done.", allExist)).toBe(
      "See [MYS-1](mention://issue/uuid-for-MYS-1). Done.",
    );
  });

  it("links identifiers wrapped in prose punctuation", () => {
    expect(preprocessIssueIdentifiers("(MYS-1) and [MYS-2]", allExist)).toContain(
      "([MYS-1](mention://issue/uuid-for-MYS-1))",
    );
  });

  // --- skip: code -------------------------------------------------------
  it("skips identifiers inside inline code", () => {
    expect(preprocessIssueIdentifiers("use `MYS-1` here", allExist)).toBe(
      "use `MYS-1` here",
    );
  });

  it("skips identifiers inside fenced code blocks", () => {
    const input = "```\nMYS-1 in code\n```";
    expect(preprocessIssueIdentifiers(input, allExist)).toBe(input);
  });

  // --- skip: existing links / mentions ----------------------------------
  it("does not double-process an existing mention link", () => {
    const input = `[MYS-1](mention://issue/${UUID})`;
    expect(preprocessIssueIdentifiers(input, allExist)).toBe(input);
  });

  it("skips an identifier used as a markdown link label", () => {
    const input = "[MYS-1](https://example.com/x)";
    expect(preprocessIssueIdentifiers(input, allExist)).toBe(input);
  });

  // --- skip: urls / filenames / paths -----------------------------------
  it("skips an identifier inside a URL", () => {
    const input = "https://example.com/board/MYS-1";
    expect(preprocessIssueIdentifiers(input, allExist)).toBe(input);
  });

  it("skips a filename token like ABC-123.ts", () => {
    const input = "open ABC-123.ts now";
    expect(preprocessIssueIdentifiers(input, allExist)).toBe(input);
  });

  it("skips a path segment like FOO-1/bar", () => {
    const input = "path FOO-1/bar/baz";
    expect(preprocessIssueIdentifiers(input, allExist)).toBe(input);
  });

  // --- non-matches ------------------------------------------------------
  it("ignores lowercase tokens", () => {
    const input = "some-word-1 and mul-1";
    expect(preprocessIssueIdentifiers(input, allExist)).toBe(input);
  });

  it("ignores a token embedded in a larger word", () => {
    const input = "XMUL-1A stays";
    expect(preprocessIssueIdentifiers(input, allExist)).toBe(input);
  });

  it("returns input unchanged when no candidates exist", () => {
    const input = "plain text with no identifiers";
    expect(preprocessIssueIdentifiers(input, allExist)).toBe(input);
  });
});

describe("isIssueIdentifier", () => {
  it("accepts a bare identifier", () => {
    expect(isIssueIdentifier("MYS-2109")).toBe(true);
    expect(isIssueIdentifier("TES-1")).toBe(true);
  });

  it("rejects a UUID (so real mentions are not treated as identifiers)", () => {
    expect(isIssueIdentifier(UUID)).toBe(false);
  });

  it("rejects lowercase and malformed tokens", () => {
    expect(isIssueIdentifier("mys-1")).toBe(false);
    expect(isIssueIdentifier("MYS-")).toBe(false);
    expect(isIssueIdentifier("MYS1")).toBe(false);
  });
});

/**
 * The mobile-specific half: only CONFIRMED identifiers are rewritten, and the
 * link target is the resolved UUID rather than the identifier string.
 *
 * Both are load-bearing. The server 404s an identifier naming no issue, and the
 * detail page keys its reads AND its realtime subscription on the UUID
 * (`useIssueRealtime` self-gates on `payload.issue.id !== issueId`), so an
 * identifier target would read the right issue once and then silently stop
 * updating.
 */
describe("preprocessIssueIdentifiers — only confirmed identifiers are linked", () => {
  it("leaves an identifier that resolved to nothing as plain text", () => {
    const input = "see MYS-99999 for details";
    expect(preprocessIssueIdentifiers(input, resolver({}))).toBe(input);
  });

  it("rewrites the existing identifier and leaves the missing one alone", () => {
    const input = "MYS-2109 is done, MYS-99999 is not real";
    expect(
      preprocessIssueIdentifiers(input, resolver({ "MYS-2109": UUID })),
    ).toBe(`[MYS-2109](mention://issue/${UUID}) is done, MYS-99999 is not real`);
  });

  it("targets the resolved UUID, keeping the identifier as the visible label", () => {
    const out = preprocessIssueIdentifiers("see MYS-2109", resolver({ "MYS-2109": UUID }));
    expect(out).toBe(`see [MYS-2109](mention://issue/${UUID})`);
    // The identifier must NOT appear as the link target — that is the bug this
    // pins (realtime/cache keyed on UUID; the server also 404s unknown ones).
    expect(out).not.toContain("mention://issue/MYS-2109");
  });

  it("rewrites every occurrence of a confirmed identifier", () => {
    const out = preprocessIssueIdentifiers("MYS-1 and MYS-1", resolver({ "MYS-1": UUID }));
    expect(out).toBe(
      `[MYS-1](mention://issue/${UUID}) and [MYS-1](mention://issue/${UUID})`,
    );
  });

  it("is idempotent — a second pass does not nest links", () => {
    const once = preprocessIssueIdentifiers("see MYS-2109", resolver({ "MYS-2109": UUID }));
    expect(preprocessIssueIdentifiers(once, resolver({ "MYS-2109": UUID }))).toBe(once);
  });

  it("treats an empty resolver as 'link nothing' (the editable-path stance)", () => {
    const input = "see MYS-2109 and MUL-2";
    expect(preprocessIssueIdentifiers(input, resolver({}))).toBe(input);
  });
});

/**
 * `collectIssueIdentifiers` is what decides which identifiers the render path
 * spends a request on, so it must answer exactly the set the rewriter will act
 * on — a candidate it omits would render as dead text, and one it invents would
 * be a wasted request.
 */
describe("collectIssueIdentifiers", () => {
  it("lists distinct identifiers in first-appearance order", () => {
    expect(collectIssueIdentifiers("MYS-2 then MYS-1 then MYS-2")).toEqual([
      "MYS-2",
      "MYS-1",
    ]);
  });

  it("applies the same skips as the rewriter", () => {
    const input = [
      "prose MYS-1 here",
      "`MYS-2` inline code",
      "```\nMYS-3 fenced\n```",
      "[MYS-4](https://example.com/x)",
      "https://example.com/board/MYS-5",
      "file ABC-123.ts",
      "path FOO-1/bar",
    ].join("\n");
    expect(collectIssueIdentifiers(input)).toEqual(["MYS-1"]);
  });

  it("returns nothing for content with no identifier shape", () => {
    expect(collectIssueIdentifiers("plain prose, no ids")).toEqual([]);
    expect(collectIssueIdentifiers("")).toEqual([]);
  });

  it("agrees with the rewriter about what is rewritable", () => {
    // Every collected identifier must be one the rewriter would link when it
    // resolves — otherwise the resolver's work is thrown away.
    const input = "MYS-1 and `MYS-2` and MYS-3.ts and MYS-4";
    const collected = collectIssueIdentifiers(input);
    const rewriteFor = Object.fromEntries(collected.map((id) => [id, `u-${id}`]));
    const out = preprocessIssueIdentifiers(input, resolver(rewriteFor));
    for (const identifier of collected) {
      expect(out).toContain(`[${identifier}](mention://issue/u-${identifier})`);
    }
    expect(out).toContain("`MYS-2`");
    expect(out).toContain("MYS-3.ts");
  });
});
