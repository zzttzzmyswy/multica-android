/**
 * Filter-sheet → view-store registry (iteration-68). The issue filter sheet
 * (`/[workspace]/issues-filter`, its `issues-filter-picker` sub-sheet and
 * the `issues-filter-date` range sheet) is shared by three surfaces — the
 * workspace-wide Issues page (`scope=all`), My Issues (`scope=my`), and
 * since iteration-68 the project-detail issue surface (`scope=project`).
 * Each surface keeps its own filter/sort/grouping store, so the sheets must
 * resolve the `scope` route param to the matching store.
 *
 * `issueFilterStoreForScope` returns the store OBJECT, usable as a hook
 * (`issueFilterStoreForScope(scope)()`) or imperatively
 * (`issueFilterStoreForScope(scope).getState()`). Callers still subscribe
 * exactly one store per render (the branch is stable for a route instance),
 * matching the two-store pattern the sheets shipped before a third surface
 * arrived.
 */
import { useIssuesViewStore } from "./issues-view-store";
import { useMyIssuesViewStore } from "./my-issues-view-store";
import { useProjectIssuesViewStore } from "./project-issues-view-store";

/** The `scope` route param vocabulary of the shared filter sheets. */
export type IssueFilterScope = "my" | "all" | "project";

export function issueFilterStoreForScope(scope: IssueFilterScope) {
  switch (scope) {
    case "all":
      return useIssuesViewStore;
    case "project":
      return useProjectIssuesViewStore;
    case "my":
      return useMyIssuesViewStore;
  }
}

/** Parse the filter sheets' `scope` route param; unknown/missing → "my"
 *  (the historical default before scope params existed). */
export function parseFilterScope(param: string | undefined): IssueFilterScope {
  if (param === "all") return "all";
  if (param === "project") return "project";
  return "my";
}