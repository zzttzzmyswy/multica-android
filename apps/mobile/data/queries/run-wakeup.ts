/**
 * The wakeup rule behind one run, read from the issue's rule cache — the
 * mobile port of web's `useRunWakeup`
 * (`packages/views/issues/components/wakeup-source-chip.tsx:12-20`).
 *
 * Two properties matter and both are easy to lose:
 *
 *  1. **One request per issue, not one per row.** The rule list is already
 *     fetched by `WakeupsSection` for the issue header; this hook reads the
 *     same `issueWakeupsOptions` query and narrows it with `select`, so a
 *     screen with twenty wakeup runs still issues zero extra requests. A
 *     per-row `useQuery` over a fresh key would be twenty.
 *
 *  2. **It asks only when the run says it was wakeup-triggered.** `enabled`
 *     includes `!!wakeupId`, so an ordinary run never arms the read. Without
 *     that gate, opening the runs sheet on a 200-run issue would fetch the
 *     rule list on behalf of runs that cannot use it.
 *
 * The third is a consequence of the first and is the reason this returns the
 * rule rather than a rendered label: `undefined` means "no rule to name" and
 * covers BOTH a deleted rule and a read that has not answered. The caller
 * (`lib/run-trigger-label.ts`) turns that into a complete fallback sentence,
 * never a half one — a pending read must not be published as "this run was not
 * wakeup-triggered", which is a fact we do not yet have.
 */
import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import type { IssueWakeup } from "@multica/core/types";
import { issueWakeupsOptions } from "@/data/queries/issue-wakeups";
import { useWorkspaceStore } from "@/data/workspace-store";

/**
 * Resolve `wakeupId` against `issueId`'s rules.
 *
 * `issueId` is passed explicitly rather than read off the task because the
 * task's own `issue_id` is not what the cache is keyed by on every surface —
 * the runs sheet already knows which issue it is showing, and a run row that
 * resolved a DIFFERENT issue's rules would be worse than showing none.
 */
export function useRunWakeup(
  issueId: string | null | undefined,
  wakeupId: string | null | undefined,
): IssueWakeup | undefined {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const select = useCallback(
    (rules: IssueWakeup[]) => rules.find((rule) => rule.id === wakeupId),
    [wakeupId],
  );
  const { data } = useQuery({
    ...issueWakeupsOptions(wsId, issueId ?? ""),
    enabled: !!wsId && !!issueId && !!wakeupId,
    select,
  });
  return data;
}
