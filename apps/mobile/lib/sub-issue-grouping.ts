/**
 * Pure ordering for a parent issue's direct children (sub-issues).
 *
 * Mirrors web's `groupSubIssuesByStage` (packages/views/issues/components/
 * issue-detail.tsx:398) so the mobile and web clients render a parent's
 * children in the same sequence: staged groups ascending by stage, then the
 * unstaged group (stage === null) last. Lives here (not in the component)
 * so it's a pure-function helper testable under the `lib/` vitest lane.
 */
import type { Issue } from "@multica/core/types";

export interface SubIssueGroup {
  stage: number | null;
  items: Issue[];
}

export function groupSubIssuesByStage(children: Issue[]): SubIssueGroup[] {
  const byStage = new Map<number, Issue[]>();
  const unstaged: Issue[] = [];
  for (const c of children) {
    if (c.stage != null) {
      const arr = byStage.get(c.stage);
      if (arr) arr.push(c);
      else byStage.set(c.stage, [c]);
    } else {
      unstaged.push(c);
    }
  }
  const groups: SubIssueGroup[] = [...byStage.keys()]
    .sort((a, b) => a - b)
    .map((s) => ({ stage: s, items: byStage.get(s) as Issue[] }));
  if (unstaged.length > 0) groups.push({ stage: null, items: unstaged });
  return groups;
}