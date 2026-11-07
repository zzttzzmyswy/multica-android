/**
 * Which statuses may a status control OFFER for one issue (MUL-7420, MUL-8250)
 * — the pure half of web's `useIssueStatusOptions`
 * (`packages/views/issues/utils/status-options.ts`).
 *
 * ## Why the offer is not the catalog
 *
 * The server enforces a project's workflow on every status write
 * (`server/internal/handler/issue_workflow_entry.go` → `issueworkflow.CheckStatus`):
 * a status the workflow does not list is refused with
 * `400 status_not_in_workflow`. Mobile offered the whole catalog everywhere, so
 * the phone listed statuses the desktop refused and the member only found out
 * after tapping one. This module is what makes the offer match the rule.
 *
 * ## `projectId` is three-valued, and the three cases are not interchangeable
 *
 * Straight from web, because collapsing any two re-creates the defect in a
 * subtler form:
 *
 *   - a project id — that project's workflow (its named one, else Default);
 *   - `null` — the issue is in no project. The server then enforces the
 *     workspace **Default** (`issueworkflow.OutsideProject`), so Default's
 *     statuses and nothing else;
 *   - `undefined` — the surface spans projects (a filter, a batch action), so
 *     no single workflow applies and the catalog passes through.
 *
 * ## The two rules that are easy to get wrong
 *
 * 1. **A current status the DEFAULT leaves out stays on the list.** An issue
 *    can be sitting on a status Default dropped, or one it carried out of a
 *    project that added it. Hiding it would leave the member unable to see
 *    where the issue is — and unable to move it off, since the checked row
 *    would be gone. It is inserted after the last step of its own category,
 *    where web puts it. The grace is Default-only: inside a *named* workflow
 *    web does not re-add it, and neither do we (the write would still refuse).
 * 2. **"Workflows unknown" is not "no workflow".** Both reach the helpers as an
 *    absent list and both fall back to the catalog — refusing every status
 *    while a fetch is in flight would be worse than the old behaviour. What
 *    must not happen is that fallback being *presented as the answer*, so this
 *    module reports `authoritative` separately from the options themselves and
 *    the picker says so when it is false.
 */
import type { IssueStatusCategory, IssueWorkflow, Project } from "@multica/core/types";
import type { StatusOption } from "@/lib/status-options-core";
import { defaultWorkflow, resolveProjectWorkflow } from "@/lib/workflow";

/**
 * How much of the workflow read has landed.
 *
 * Three values rather than a boolean, because "still loading" and "failed" lead
 * to the same option list but to different copy: one is a moment, the other is
 * a problem with a retry. `data/queries/workflows.ts` owns this mapping.
 */
export type WorkflowReadState = "pending" | "ready" | "failed";

export interface StatusScope {
  /**
   * The workflow whose columns this issue may take — the project's own, or
   * Default for a project that names none AND for an issue outside any project.
   * Null when nothing limits the issue (a spanning surface, a server without
   * workflows) or when the read has not settled.
   */
  workflow: IssueWorkflow | null;
  /**
   * Set only when Default is standing in for an issue OUTSIDE any project.
   *
   * `workflow` alone cannot express that case's one real difference: outside a
   * project nothing hands off (`issueworkflow.ForProject` is nil there), so a
   * surface that draws handoff hints must read THIS field, not `workflow`, to
   * know it may. Web models it the same way (MUL-8121).
   */
  defaultScope: IssueWorkflow | null;
  /**
   * True when {@link StatusScope.workflow} (or the absence of one) is a
   * verified answer: the read settled. False means the option list built from
   * this scope is a fallback and may include statuses the server refuses.
   */
  authoritative: boolean;
  state: WorkflowReadState;
}

export interface StatusScopeInput {
  /** `undefined` until the read lands — never `[]`, which would claim "none". */
  workflows: readonly IssueWorkflow[] | undefined;
  state: WorkflowReadState;
  projectId: string | null | undefined;
  /** `undefined` until the project list lands; only read for a named project. */
  projects: readonly Pick<Project, "id" | "workflow_id">[] | undefined;
}

/** The scope for one issue's status control. */
export function resolveStatusScope(input: StatusScopeInput): StatusScope {
  const { workflows, state, projectId, projects } = input;
  // A read that has not settled cannot name a workflow: an absent list means
  // "unknown", and picking Default out of nothing would be a guess presented
  // as a rule.
  if (state !== "ready") {
    return { workflow: null, defaultScope: null, authoritative: false, state };
  }
  // A settled read always yields an authoritative answer, even when it is
  // "nothing limits this issue" — that is a fact about the workspace (an older
  // server has no workflow table), not a gap in what we know.
  if (projectId === undefined) {
    return { workflow: null, defaultScope: null, authoritative: true, state };
  }
  const project = projectId ? projects?.find((p) => p.id === projectId) ?? null : null;
  const workflow = resolveProjectWorkflow(workflows, project);
  const outsideProject = projectId === null;
  const resolved = workflow ?? (outsideProject ? defaultWorkflow(workflows) : null);
  return {
    workflow: resolved,
    // Outside a project, nothing hands off — see the field's own doc.
    defaultScope: outsideProject ? resolved : null,
    authoritative: true,
    state,
  };
}

/**
 * Category order, for placing a re-added status.
 *
 * Mobile ranks the 7 built-in status keys; web ranks its 4 lifecycle
 * categories (`ALL_STATUSES` in `packages/core/issues/config/status.ts`). The
 * rule is the same — "after the last step later in the lifecycle" — but this
 * vocabulary is finer, so a custom status and the built-in it behaves as can
 * never be confused. That divergence is the whole `lib/issue-status-catalog.ts`
 * layer, not a new decision here.
 */
const CATEGORY_RANK = new Map<string, number>();

function categoryRank(category: IssueStatusCategory, categories: readonly IssueStatusCategory[]): number {
  if (CATEGORY_RANK.size !== categories.length) {
    CATEGORY_RANK.clear();
    categories.forEach((value, index) => CATEGORY_RANK.set(value, index));
  }
  return CATEGORY_RANK.get(category) ?? categories.length;
}

/**
 * The concrete option list to render, in offer order.
 *
 * `catalog` is the workspace's assignable catalog in canonical order
 * (`useStatusOptions().options`) — used both as the fallback for an unlimited
 * issue and as the label/color source for a listed one. A step naming a status
 * the catalog does not carry (a custom status from a workflow read the catalog
 * has not caught up with) still becomes an option, built from the bare key:
 * dropping it would silently remove a column the server accepts.
 */
export function workflowStatusOptions(
  catalog: readonly StatusOption[],
  scope: StatusScope,
  currentStatus: string | null | undefined,
  categories: readonly IssueStatusCategory[],
): StatusOption[] {
  const listed = scope.workflow;
  if (!listed) return [...catalog];
  const byKey = new Map(catalog.map((option) => [option.key, option]));
  const optionOf = (key: string): StatusOption =>
    byKey.get(key) ?? {
      key,
      label: key,
      color: null,
      category: categoryOfKey(key, catalog, categories),
    };
  const steps = listed.steps.map((step) => optionOf(step.status_key));
  return keepCurrentStatus(steps, listed, currentStatus, optionOf, categories);
}

/** The category a listed-but-uncatalogued status behaves as. */
function categoryOfKey(
  key: string,
  catalog: readonly StatusOption[],
  categories: readonly IssueStatusCategory[],
): IssueStatusCategory {
  // A built-in key IS its category; anything else has no catalog row to ask,
  // so it lands in the first category rather than inventing a name for it.
  return (categories as readonly string[]).includes(key)
    ? (key as IssueStatusCategory)
    : catalog[0]?.category ?? categories[0]!;
}

/**
 * Re-adds a current status the DEFAULT leaves out, after the last step of its
 * own category. See rule 1 in the module doc; the insertion scan is web's.
 */
function keepCurrentStatus(
  steps: StatusOption[],
  listed: IssueWorkflow,
  currentStatus: string | null | undefined,
  optionOf: (key: string) => StatusOption,
  categories: readonly IssueStatusCategory[],
): StatusOption[] {
  if (!listed.is_default || !currentStatus) return steps;
  if (steps.some((option) => option.key === currentStatus)) return steps;
  const current = optionOf(currentStatus);
  const rank = categoryRank(current.category, categories);
  let at = steps.length;
  while (at > 0 && categoryRank(steps[at - 1]!.category, categories) > rank) at -= 1;
  return [...steps.slice(0, at), current, ...steps.slice(at)];
}
