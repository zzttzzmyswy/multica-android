/**
 * The per-row enable/disable behind the workspace table's switch (MYS-2043).
 *
 * Web's row binds `useDisableIssueWakeup(wsId, row.issue_id)` and
 * `useEnableIssueWakeup(wsId, row.issue_id)` — a hook PAIR per row, created
 * inside the row component. That works on web because a row is its own
 * component, and it works here too (the table's row is one). What web does not
 * have, and the table does need, is whether a write for a given ISSUE is in
 * flight so exactly that row's switch can go busy while the other nineteen stay
 * live.
 *
 * A per-row hook pair cannot answer that for its parent — the pending flag lives
 * inside the hook instance the ROW owns. So this hook takes the other shape: ONE
 * mutation whose variables carry the row, plus a pending set the table can read
 * by issue id. That also removes a real hazard of the per-row shape, which is
 * that a rule whose `issue_id` changes underneath a mounted row (a page refetch
 * after a filter change) would leave the old pair bound to the old issue.
 *
 * The write itself is the same endpoint the issue surface uses, with the row's
 * own `issue_id` and `id` — a rule carries its issue, so no caller has to be
 * told which issue it is acting on.
 *
 * Reporting goes through the QueryClient's MutationCache, from the meta this
 * mutation carries (`lib/write-failure.ts`). There is deliberately no per-call
 * `onError`: both channels fire while the caller is mounted, so attaching this
 * one too would raise two dialogs for one failure.
 */
import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { WorkspaceWakeup } from "@multica/core/types";
import { api } from "@/data/api";
import { invalidateIssueWakeups } from "@/data/mutations/issue-wakeups";
import { useWorkspaceStore } from "@/data/workspace-store";
import { needsWakeupRearm } from "@/lib/wakeup-controls";
import {
  WRITE_FAILURE_CONFLICT_KEY,
  WRITE_FAILURE_PERMISSION_KEY,
  WRITE_FAILURE_TITLE_KEY,
} from "@/lib/write-failure";

export interface IssueWakeupToggles {
  /** Whether a write for this issue's rule is in flight. */
  isPending: (issueId: string) => boolean;
  /** Flip one row's rule. */
  setEnabled: (row: WorkspaceWakeup, enabled: boolean) => void;
}

export function useIssueWakeupToggles(): IssueWakeupToggles {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const queryClient = useQueryClient();
  // Keyed by ISSUE id, not rule id: the writes are per issue, so that is the
  // unit whose in-flight state a row reads.
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());

  const mutation = useMutation({
    meta: {
      [WRITE_FAILURE_TITLE_KEY]: "wakeups.disableError",
      [WRITE_FAILURE_CONFLICT_KEY]: "wakeups.conflictError",
      [WRITE_FAILURE_PERMISSION_KEY]: "wakeups.permissionError",
    },
    mutationFn: ({
      row,
      enabled,
    }: {
      row: WorkspaceWakeup;
      enabled: boolean;
    }) =>
      enabled
        ? // An enable needs a usable revision: the server fences the write on
          // it and answers 400 for a missing one, so a row whose revision could
          // not be read is not enabled at all. `rearm` restarts a spent
          // one-shot or an expired `at` rule, which the server refuses without
          // ("consumed one-shot requires explicit rearm").
          api.enableIssueWakeup(row.issue_id, row.id, {
            revision: row.revision ?? 0,
            rearm: needsWakeupRearm(row),
          })
        : // A disable takes no body on purpose — stopping a misbehaving rule
          // must not be gated on a field the client failed to read.
          api.disableIssueWakeup(row.issue_id, row.id),
    onMutate: ({ row }) => {
      setPending((prev) => new Set(prev).add(row.issue_id));
    },
    onSettled: (_data, _error, { row }) => {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(row.issue_id);
        return next;
      });
      // The rule list, the platform rules and the issue's TASKS — the last
      // because a row reads its run state from the task, so a disable that
      // withdrew a queued run without clearing `tasks` would leave the issue
      // showing a run that no longer exists.
      void invalidateIssueWakeups(queryClient, wsId, row.issue_id);
    },
  });

  const setEnabled = useCallback(
    (row: WorkspaceWakeup, enabled: boolean) => {
      mutation.mutate({ row, enabled });
    },
    [mutation],
  );

  return {
    isPending: (issueId) => pending.has(issueId),
    setEnabled,
  };
}
