/**
 * Which snippet lines a search result row renders.
 *
 * Web renders the two snippet kinds independently
 * (packages/views/search/search-command.tsx:206-224): a description hit shows
 * a FileText line, a comment hit shows a MessageSquare line, and a result can
 * carry both at once. Mobile previously gated a single line on
 * `match_source === "comment"` and read `matched_snippet`, which silently
 * dropped every description-only hit.
 *
 * Server field semantics (server/internal/handler/issue.go:758-774):
 *   - a matching comment  ⇒ `matched_comment_snippet` (and, for backward
 *     compatibility with old clients, `matched_snippet` as well)
 *   - a matching description ⇒ `matched_description_snippet` only
 *
 * So the canonical pair is the two specific fields; the legacy
 * `matched_snippet` is redundant with `matched_comment_snippet` and is
 * deliberately not read here.
 */
import { describe, expect, it } from "vitest";
import { searchIssueSnippets } from "./search-snippets";

describe("searchIssueSnippets", () => {
  it("returns nothing when neither snippet is present", () => {
    expect(searchIssueSnippets({})).toEqual([]);
  });

  it("renders a description-only hit", () => {
    expect(
      searchIssueSnippets({ matched_description_snippet: "…the deploy step…" }),
    ).toEqual([{ kind: "description", text: "…the deploy step…" }]);
  });

  it("renders a comment-only hit", () => {
    expect(
      searchIssueSnippets({ matched_comment_snippet: "…fixed in 8d8512f…" }),
    ).toEqual([{ kind: "comment", text: "…fixed in 8d8512f…" }]);
  });

  it("renders description before comment when both matched", () => {
    expect(
      searchIssueSnippets({
        matched_description_snippet: "desc hit",
        matched_comment_snippet: "comment hit",
      }),
    ).toEqual([
      { kind: "description", text: "desc hit" },
      { kind: "comment", text: "comment hit" },
    ]);
  });

  it("ignores blank and whitespace-only snippets", () => {
    expect(
      searchIssueSnippets({
        matched_description_snippet: "",
        matched_comment_snippet: "   ",
      }),
    ).toEqual([]);
  });

  it("does not fall back to the legacy matched_snippet field", () => {
    // The server mirrors comment hits into `matched_snippet`; reading it too
    // would double-render the same line.
    expect(
      searchIssueSnippets({
        matched_snippet: "legacy",
        matched_comment_snippet: "comment hit",
      }),
    ).toEqual([{ kind: "comment", text: "comment hit" }]);
    expect(searchIssueSnippets({ matched_snippet: "legacy only" })).toEqual([]);
  });

  it("treats a null snippet as absent", () => {
    expect(
      searchIssueSnippets({
        matched_description_snippet: null,
        matched_comment_snippet: null,
      }),
    ).toEqual([]);
  });
});
