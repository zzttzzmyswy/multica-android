/**
 * Address of the workspace search panel, plus the one fact it needs from its
 * opener: which issue (if any) it was opened over.
 *
 * `issueId` rides as a query param because the panel is its own modal route —
 * its pathname is `/search`, never the issue's, so it cannot recover the fact
 * from the route the way web's portal can (`search-command.tsx:311-318` parses
 * `currentIssueId` out of `pathname`). The panel uses it to gate the four
 * issue-scoped commands.
 *
 * Kept as a pure function so the URL shape is testable in the Node vitest lane.
 */
export function searchPath(slug: string, issueId?: string | null): string {
  const base = `/${slug}/search`;
  return issueId ? `${base}?issueId=${encodeURIComponent(issueId)}` : base;
}
