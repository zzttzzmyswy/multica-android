/**
 * Snippet lines for a search result row — pure, i18n-free.
 *
 * See search-snippets.test.ts for the field semantics this encodes.
 */

export type SearchSnippetKind = "description" | "comment";

export interface SearchSnippet {
  kind: SearchSnippetKind;
  text: string;
}

interface SearchSnippetSource {
  matched_description_snippet?: string | null;
  matched_comment_snippet?: string | null;
  /**
   * Accepted so the real `SearchIssueResult` can be passed straight through,
   * but deliberately unread: the server mirrors a comment hit into this field
   * for old clients, so reading it would render the same line twice.
   */
  matched_snippet?: string | null;
}

/**
 * Snippets to render, in web's order: the description hit first, then the
 * comment hit. Blank snippets are dropped rather than rendered as an empty
 * line.
 */
export function searchIssueSnippets(
  issue: SearchSnippetSource,
): SearchSnippet[] {
  const candidates: SearchSnippet[] = [
    { kind: "description", text: issue.matched_description_snippet ?? "" },
    { kind: "comment", text: issue.matched_comment_snippet ?? "" },
  ];
  return candidates.filter((s) => s.text.trim().length > 0);
}
