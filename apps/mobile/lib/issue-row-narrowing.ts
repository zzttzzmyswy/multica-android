/**
 * The two issue-list dimensions that must narrow the SERVER window rather
 * than the loaded page (MYS-2066).
 *
 * Both were client-only predicates on mobile and both are server-side
 * narrowings on web. The difference is only visible when the result set is
 * larger than one page — which is the normal state of a real workspace:
 *
 *   - 「智能体工作中」 (`workingOnly`) narrowed via `applyIssueFilters` over the
 *     loaded window. `GET /api/issues` returns the first 100 rows and the list
 *     view deliberately does not drain (`more/issues.tsx:462-470`), so the
 *     switch asked "which of the newest 100 issues is an agent working on".
 *     Measured on the deployment: 1996 issues, 3 running, **0 of them in the
 *     first page** — the switch always listed nothing.
 *   - 「显示子任务」 off (`showSubIssues === false`) hid the sub-issues the
 *     loaded page happened to contain (22 of the first 100), not all 231 the
 *     workspace has.
 *
 * Web sends both on the same `tableQuerySpec` that produces its rows
 * (`packages/views/issues/surface/use-issue-surface-controller.ts:441-444`):
 *
 * ```ts
 * ...(agentRunningFilter ? { working_issue_ids: [...workingIssueIDs] } : {}),
 * include_sub_issues: showSubIssues,
 * ```
 *
 * `GET /api/issues` spells the same two restrictions `ids` and
 * `top_level_only` (server/internal/handler/issue.go:1136-1151). This module
 * is the projection from the view store's switches onto those params.
 *
 * ## The two rules that make it safe
 *
 * 1. **Carry only while active.** Both dimensions change the window's IDENTITY
 *    (they are part of the list cache key via `issueParamsKey`). `ids` carries
 *    a set that moves second-to-second, so emitting it while the switch is off
 *    would refetch and re-key every list each time any task started or stopped.
 *    `top_level_only` has a default-on switch, so emitting it in the default
 *    state would put a key on every list for no narrowing. Web gates the first
 *    exactly this way; the second follows from `include_sub_issues` being a
 *    plain boolean the server only acts on when false.
 * 2. **Empty is a real answer, absent is not.** `workingOnly` on with an empty
 *    running set means "no agent is working", and the window must be empty —
 *    not unrestricted. The server reads PRESENCE of `ids` (issue.go:1136), so
 *    the empty list is sent as `ids=` and narrows to nothing. Omitting it
 *    instead would restore the whole workspace at the one moment the user is
 *    most likely to notice, which is the original defect wearing a different
 *    hat.
 *
 * ## Fail-closed on the unresolved projection
 *
 * `runningIssueIds === undefined` means the agent-task snapshot has not landed.
 * The switch being on is the user asking for "only what is working", and
 * nothing has been shown to be working yet — so this yields the empty window.
 * `applyIssueFilters` takes the same read for its rows
 * (`lib/filter-issues.ts:140-147`), and `withWorkingCountDimension` takes it
 * for the counts. All three must agree, or the list and its header counts
 * describe different sets during that first paint.
 */
import type { IssueListWindowParams } from "@/data/queries/issue-keys";

/**
 * The row window plus the two switches that narrow it server-side. A structural
 * subset of `IssueFilterSlice`, so a surface can pass the store's own fields.
 */
export interface IssueRowNarrowingInput {
  /** 「智能体工作中」 — restrict rows to issues an agent is running. */
  workingOnly: boolean;
  /** 「显示子任务」 — only an explicit `false` hides sub-issues, matching the
   *  client predicate (`filter-issues.ts:197`: `showSubIssues === false`). */
  showSubIssues: boolean;
}

/**
 * The two server params these switches produce, ready to spread into the list
 * window. Empty when both are in their default (off / on) state, so the caller
 * can spread it unconditionally without changing the window's identity.
 *
 * `runningIssueIds` is `undefined` while the agent-task snapshot is
 * unresolved; see the module doc for why that must fail closed.
 */
export function issueRowNarrowing(
  input: IssueRowNarrowingInput,
  runningIssueIds: ReadonlySet<string> | undefined,
): Pick<IssueListWindowParams, "ids" | "top_level_only"> {
  const narrowing: Pick<IssueListWindowParams, "ids" | "top_level_only"> = {};
  if (input.workingOnly) {
    // Sorted so the window bag — and therefore `issueParamsKey` — is stable
    // across two snapshots that differ only in Set iteration order. Without
    // this a re-derived snapshot would re-key the query and refetch for rows
    // that did not change.
    narrowing.ids = [...(runningIssueIds ?? [])].sort();
  }
  if (input.showSubIssues === false) narrowing.top_level_only = true;
  return narrowing;
}
