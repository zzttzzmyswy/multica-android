/**
 * Picker route map for issue-detail edit affordances, plus the "open the
 * picker for THIS issue" helper.
 *
 * Two surfaces push the same formSheet pickers, each bound to a different
 * issue: the detail page's attribute chip row (`issue/[id]`) and the
 * sub-issue rows in the header, which edit a CHILD issue in place while the
 * detail page stays mounted on the parent. Sharing the map keeps the two in
 * lockstep — a route renamed in `_layout.tsx` breaks both at compile time
 * rather than silently pushing `as never` (the pre-iter-130 behaviour).
 *
 * Every entry is registered in `app/(app)/[workspace]/_layout.tsx` with the
 * shared SHEET_OPTIONS (formSheet + iOS native grabber + explicit numeric
 * detents).
 */
import type { QueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import type { Issue } from "@multica/core/types";
import { issueKeys } from "@/data/queries/issue-keys";

export type IssuePickerField =
  | "status"
  | "priority"
  | "assignee"
  | "label"
  | "project"
  | "due-date"
  | "start-date"
  | "stage";

export const ISSUE_PICKER_PATHNAMES = {
  status: "/[workspace]/issue/[id]/picker/status",
  priority: "/[workspace]/issue/[id]/picker/priority",
  assignee: "/[workspace]/issue/[id]/picker/assignee",
  label: "/[workspace]/issue/[id]/picker/label",
  project: "/[workspace]/issue/[id]/picker/project",
  "due-date": "/[workspace]/issue/[id]/picker/due-date",
  "start-date": "/[workspace]/issue/[id]/picker/start-date",
  stage: "/[workspace]/issue/[id]/picker/stage",
} as const satisfies Record<IssuePickerField, string>;

/**
 * Push the picker sheet for `issue`, seeding the detail cache first.
 *
 * The seed is what makes editing a sub-issue in place correct: every picker
 * route reads its current value from `issueDetailOptions(...)`, which is a
 * cache MISS for a child issue the user never opened — the route would fall
 * back to its `todo` default and mint a wrong value on the first tap. The
 * row already holds the real `Issue`, so hand it to the cache on the way in.
 */
export function openIssuePicker(
  field: IssuePickerField,
  issue: Issue,
  wsSlug: string | undefined,
  wsId: string | null,
  queryClient: QueryClient,
): void {
  if (!wsSlug) return;
  queryClient.setQueryData(issueKeys.detail(wsId, issue.id), issue);
  router.push({
    pathname: ISSUE_PICKER_PATHNAMES[field],
    params: { workspace: wsSlug, id: issue.id },
  });
}
