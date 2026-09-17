/**
 * Route-param construction for "new sub-issue under this one" — the phone's
 * equivalent of web's `meta.createSubIssue(issue)` in the issue table's
 * `InlineTitle` (packages/views/issues/components/table-view.tsx:2103):
 *
 *   onCreateIssue({
 *     parent_issue_id: issue.id,
 *     parent_issue_identifier: issue.identifier,
 *     ...(issue.project_id ? { project_id: issue.project_id } : {}),
 *   })
 *
 * Kept in its own module (no expo-router import) so the rule about which
 * fields ride along is testable in the node-only vitest lane.
 */
import type { Issue } from "@multica/core/types";

/**
 * Route params for the new-issue form seeded from a parent issue. A named
 * shape rather than a string bag, so the producer (the issue table's `+`) and
 * the consumer (`new-issue.tsx`'s `useLocalSearchParams`) share one
 * definition — a typo in a key would otherwise compile on both sides and
 * silently drop the parent.
 */
export interface SubIssueRouteParams {
  parentIssueId: string;
  parentIssueIdentifier?: string;
  parentProjectId?: string;
}

/**
 * Params for the new-issue form seeded from a parent issue.
 *
 * `parentProjectId` is copied only when the parent has a project, exactly as
 * web's spread does — passing an empty/null project through would look like a
 * real id to the server rather than "no project", and the identifier is only
 * carried for the chip label (the server needs the id alone).
 */
export function subIssueRouteParams(
  parent: Pick<Issue, "id" | "identifier" | "project_id">,
): SubIssueRouteParams {
  return {
    parentIssueId: parent.id,
    ...(parent.identifier ? { parentIssueIdentifier: parent.identifier } : {}),
    ...(parent.project_id ? { parentProjectId: parent.project_id } : {}),
  };
}
