/**
 * The workspace-level wakeup writes (MYS-2043) — the two surfaces web hangs
 * mutations off that mobile had none for:
 *
 *   - `useDisableWorkspaceWakeups` — the batch "turn off selected" on the
 *     cross-issue table. Web's is a SEQUENTIAL loop over `disableIssueWakeup`
 *     that returns `{failed, succeeded}`; the partial case is a first-class
 *     outcome, not an error.
 *   - `useUpdateWorkspaceSystemWakeup` — the platform rule's workspace default
 *     behind 设置 → 唤醒, which the server restricts to owner/admin.
 *
 * Both go through the SAME endpoints the per-issue rules use
 * (`POST /api/issues/:id/wakeups/:wakeupId/disable`, which takes the issue id
 * in its path). A row from the table carries its own `issue_id`, which is why
 * the batch can act on rows from many issues with one loop and why the sheet
 * never has to be told which issue it is acting on — the rule does.
 *
 * Divergences from web, each deliberate:
 *
 *   1. **No optimistic patch**, matching this fork's other wakeup writes: a
 *      disable changes `revision`, `disabled_at` and possibly a run's status,
 *      none of which the client computes. A hand-written forward patch would
 *      put values on screen the server never confirmed. See
 *      `data/mutations/issue-wakeups.ts` for the full argument.
 *   2. **Both carry a write-failure title.** Mobile's reporting channel is the
 *      QueryClient's MutationCache (`lib/write-failure.ts`), which only fires
 *      for a mutation whose own options carry the meta. A batch that failed
 *      silently is the worst version of the silent-write defect: the user sees
 *      rows that still read "on" and no reason why.
 *   3. **The batch reports its own partial result** rather than relying on the
 *      alert channel. `{failed, succeeded}` is a SUCCESSFUL mutation with an
 *      unhappy payload — three of fifteen rules refused — so it must reach the
 *      screen through the caller's result line, not through an error toast
 *      that would be indistinguishable from the whole batch failing.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  WorkspaceSystemWakeup,
  WorkspaceWakeup,
} from "@multica/core/types";
import { api } from "@/data/api";
import { issueKeys } from "@/data/queries/issue-keys";
import { workspaceWakeupInvalidationKeys } from "@/lib/workspace-wakeups";
import {
  WRITE_FAILURE_CONFLICT_KEY,
  WRITE_FAILURE_PERMISSION_KEY,
  WRITE_FAILURE_TITLE_KEY,
} from "@/lib/write-failure";
import { useWorkspaceStore } from "@/data/workspace-store";

/**
 * Turn off several rules, sequentially, and report what happened to each.
 *
 * Pure over its `disable` argument rather than reaching for `api` itself, for
 * the reason this fork keeps splitting decision layers out: the Node vitest lane
 * has no renderer, so logic written inside `useMutation`'s `mutationFn` cannot
 * be tested at all. The partial-failure contract below is a must-agree point
 * with web, and it is the one thing about this write a user can be misled by.
 *
 * Sequential, like web's, and for the same reason: it bounds the load a single
 * tap puts on the server (a page is 20 rows, and a phone on a weak link firing
 * 20 parallel writes is a self-inflicted timeout), and it is what makes the
 * per-row outcome knowable — `Promise.allSettled` would also work, but the
 * result would be "which promise rejected" rather than "which rule refused".
 *
 * A refusal is RECORDED, never rethrown: aborting the loop on the first refusal
 * would leave the remaining rules on with no record that they were never
 * attempted. The caller gets `{failed, succeeded}` and decides how to report it.
 */
export async function disableWorkspaceWakeupsSequentially(
  rows: readonly WorkspaceWakeup[],
  disable: (issueId: string, wakeupId: string) => Promise<unknown>,
): Promise<{ failed: string[]; succeeded: number }> {
  const failed: string[] = [];
  for (const row of rows) {
    try {
      await disable(row.issue_id, row.id);
    } catch {
      failed.push(row.id);
    }
  }
  return { failed, succeeded: rows.length - failed.length };
}

/**
 * Turn off several rules at once.
 *
 * Returns `{failed, succeeded}` and deliberately does NOT throw on a partial
 * failure. A batch where 12 of 15 succeeded is not an error the user should see
 * as "operation failed"; it is a result they need to read, with the three
 * failures left selected so a retry is one tap. Only a total failure is close to
 * an error, and even then `failed` carries every id.
 */
export function useDisableWorkspaceWakeups() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const queryClient = useQueryClient();
  return useMutation({
    meta: {
      [WRITE_FAILURE_TITLE_KEY]: "autopilots.wakeups.batch_failed",
      [WRITE_FAILURE_CONFLICT_KEY]: "wakeups.conflictError",
      [WRITE_FAILURE_PERMISSION_KEY]: "wakeups.permissionError",
    },
    mutationFn: (rows: readonly WorkspaceWakeup[]) =>
      disableWorkspaceWakeupsSequentially(
        rows,
        // Bound method reference: `api.disableIssueWakeup` is reached through
        // `api`, so the loop's callback cannot lose the client's `this`.
        (issueId, wakeupId) => api.disableIssueWakeup(issueId, wakeupId),
      ),
    onSettled: (_data, _error, rows) => {
      if (!wsId) return;
      // The decision layer names the keys; this only performs them. A null
      // workspace means the keys belong to no workspace, so invalidating would
      // clear a cache nobody reads and leave the visible one stale — the same
      // guard `invalidateIssueWakeups` documents.
      const keys = workspaceWakeupInvalidationKeys(
        rows.map((row) => row.issue_id),
      );
      void queryClient.invalidateQueries({
        queryKey: issueKeys.workspaceWakeupsAll(wsId),
      });
      if (keys.issueWakeups) {
        void queryClient.invalidateQueries({
          queryKey: issueKeys.all(wsId),
        });
      }
      for (const issueId of keys.taskIssueIds) {
        void queryClient.invalidateQueries({
          queryKey: issueKeys.tasks(wsId, issueId),
        });
      }
      void queryClient.invalidateQueries({
        queryKey: issueKeys.workspaceSystemWakeups(wsId),
      });
    },
  });
}

/**
 * Change the platform rule's workspace default (owner/admin only).
 *
 * Omitted fields keep their value server-side, which is why the switch sends
 * `enabled` alone and the instruction survives — the same contract the
 * per-issue system rule uses.
 *
 * The response IS the new state (the endpoint answers with the workspace's rule
 * list), so it is seeded directly rather than followed by a refetch of the same
 * endpoint. The issue-level system-rule caches are invalidated as well, because
 * the default reaches every issue that never set its own: the issues tab of a
 * reader who then opens one would otherwise still show the old default.
 */
export function useUpdateWorkspaceSystemWakeup() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const queryClient = useQueryClient();
  return useMutation({
    meta: {
      [WRITE_FAILURE_TITLE_KEY]: "settings.wakeups.save_error",
      [WRITE_FAILURE_CONFLICT_KEY]: "wakeups.conflictError",
      // The endpoint is owner/admin only and answers 403 otherwise, so the
      // permission line is the one a non-admin needs to read.
      [WRITE_FAILURE_PERMISSION_KEY]: "settings.wakeups.admin_only",
    },
    mutationFn: ({
      rule,
      ...input
    }: {
      rule: WorkspaceSystemWakeup["rule"];
      enabled?: boolean;
      instruction?: string;
    }) => api.updateWorkspaceSystemWakeup(rule, input),
    onSuccess: (rules) => {
      if (!wsId) return;
      queryClient.setQueryData(issueKeys.workspaceSystemWakeups(wsId), rules);
      // Every issue that follows this default now shows a different rule.
      void queryClient.invalidateQueries({ queryKey: issueKeys.all(wsId) });
    },
  });
}
