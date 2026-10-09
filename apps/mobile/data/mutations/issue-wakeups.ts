/**
 * Wakeup-rule mutations (MYS-2031) — the write half of the issue wakeup
 * section, mirroring web's `packages/core/issues/wakeups.ts:36-160`.
 *
 * Why this did not exist: MYS-2023 wired the READ path only, and said so. The
 * effect on a phone was a section that described a rule in detail and offered
 * no way to act on it — a user who could see "waiting for trigger" could not
 * stop it, could not wake it now, could not fix its prompt, could not delete
 * it, while web hangs four mutations off every row.
 *
 * Three deliberate differences from web:
 *
 *   1. **No optimistic patch.** Web's list is invalidated on `onSettled`
 *      without a forward patch, and so is this one. A wakeup write changes
 *      fields the client does not compute — `revision`, `next_fire_at`,
 *      `fire_count`, `disabled_at` — so a hand-written forward patch would put
 *      values on screen the server never confirmed. The reads are cached and
 *      the write is one tap; a refetch is both simpler and truthful.
 *
 *   2. **The 409 refreshes.** Web's `onSettled` invalidates unconditionally,
 *      which happens to cover a conflict. Here the refresh is driven by
 *      `onError` for a conflict only (see `wakeupWriteNeedsRefresh`), because
 *      mobile's reads are stale-timed rather than polled (see
 *      `data/queries/issue-wakeups.ts` for why the 10s poll was rejected) and
 *      an unconditional refetch after every failure is a request that cannot
 *      change anything.
 *
 *   3. **Every hook carries a write-failure title.** Mobile's reporting
 *      channel is the QueryClient's MutationCache (`lib/write-failure.ts`), and
 *      it only fires for a mutation whose own options carry the meta. Without
 *      it a rejected toggle would roll nothing back and say nothing — the
 *      silent-write defect iteration 195 closed. The 409 gets its own line on
 *      top, because "the rule moved, refresh" is the one failure the user can
 *      act on where the server's raw sentence is written for a developer.
 */
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { IssueWakeupInput, SystemWakeup } from "@multica/core/types";
import { api } from "@/data/api";
import { issueKeys } from "@/data/queries/issue-keys";
import { useWorkspaceStore } from "@/data/workspace-store";
import { wakeupWriteNeedsRefresh } from "@/lib/wakeup-controls";
import {
  WRITE_FAILURE_CONFLICT_KEY,
  WRITE_FAILURE_PERMISSION_KEY,
  WRITE_FAILURE_TITLE_KEY,
} from "@/lib/write-failure";

/**
 * Everything a wakeup write can have made stale, for one issue.
 *
 * The list is web's `invalidateIssueWakeups` (packages/core/issues/wakeups.ts:
 * 120-129) minus the three keys this fork has no cache for
 * (`workspace-wakeups`, `issue-wakeup-summaries`, `issue-wakeup-paused` — the
 * mobile build ships no workspace wakeup table; see the issue's "not doing"
 * section).
 *
 * The four that remain each have a reason to be here:
 *   - `wakeups` — the rule list. Its prefix also reaches `wakeupRuns`, so one
 *     call clears a rule's trigger history too.
 *   - `systemWakeups` — the platform's child-done rule, which the same section
 *     renders beside people's rules.
 *   - `tasks` — the issue's task list. This is the one that is easy to miss and
 *     the reason this is a shared helper: a rule's row reads its run state from
 *     `wakeupRun(wakeup, tasks)` (`lib/wakeup-presentation.ts`), which matches
 *     tasks by `wakeup_id`. Patch the rule without clearing this and the row
 *     keeps showing "Running" for a run the write just cancelled — the exact
 *     "I stopped it and it still says running" complaint.
 *
 * Deliberately NOT invalidated: the issue detail and the timeline. A wakeup
 * write does not change the issue's own fields, and this runs after every
 * toggle, so sweeping them would refetch the two most expensive reads on the
 * screen for nothing. The server does write a `wakeup_created` activity, but
 * that lands in the timeline through the existing realtime/reconnect path, not
 * through this call.
 */
export function invalidateIssueWakeups(
  queryClient: QueryClient,
  wsId: string | null,
  issueId: string,
): Promise<void> {
  // A null workspace id means the workspace has not loaded. Query keys are
  // workspace-scoped, so `["issues", null, "wakeups", id]` is a real key that
  // belongs to no workspace: invalidating it would clear a cache nobody reads
  // while leaving the visible one stale.
  if (!wsId) return Promise.resolve();
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: issueKeys.wakeups(wsId, issueId) }),
    queryClient.invalidateQueries({
      queryKey: issueKeys.systemWakeups(wsId, issueId),
    }),
    queryClient.invalidateQueries({ queryKey: issueKeys.tasks(wsId, issueId) }),
  ]).then(() => undefined);
}

/** The hooks' shared plumbing: the workspace id, the cache, and the refresh a
 *  lost concurrency race needs. */
function useWakeupMutation(issueId: string) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const queryClient = useQueryClient();
  const settle = () => invalidateIssueWakeups(queryClient, wsId, issueId);
  /**
   * A 409 means the rule on screen is out of date. Re-reading is the recovery
   * the alert names, so it is done here rather than left to the user — the
   * section's reads are stale-timed, not polled, so nothing else would refresh
   * them until the next mount or reconnect.
   */
  const onError = (error: unknown) => {
    if (wakeupWriteNeedsRefresh(error)) void settle();
  };
  return { settle, onError };
}

/**
 * Create a rule (MYS-2040).
 *
 * The ten hooks above all act on a rule that already exists. This one is the
 * only way a rule comes into being from the phone, and it is the reason the
 * round exists at all: before it, a mobile user could stop a rule and could not
 * start one.
 *
 * Same refuse-to-lie discipline as the others: no optimistic patch (a create has
 * no id to patch yet — the server assigns it), and the shared invalidation set
 * on settle, so the section refetches and the new rule appears with the server's
 * own id, revision and next_fire_at rather than values this client guessed.
 *
 * A conflict here is NOT the revision race the other hooks classify
 * (`wakeupWriteNeedsRefresh`): a create carries no revision to lose. The server
 * answers two other ways instead — a full issue/workspace is a **400** carrying
 * `{"code":"wakeup_capacity_exceeded"}` (`issue_wakeup.go:107`), which the form
 * turns into `wakeups.create.capacityError`, and a create racing its own source
 * run is a 409 `wakeup_source_busy`. Neither is repaired by re-reading the rule
 * list, so this hook deliberately carries no `WRITE_FAILURE_CONFLICT_KEY` and no
 * `onError` refresh: the alert names the failure and the user retries.
 */
export function useCreateIssueWakeup(issueId: string) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const queryClient = useQueryClient();
  return useMutation({
    meta: {
      [WRITE_FAILURE_TITLE_KEY]: "wakeups.createError",
      [WRITE_FAILURE_PERMISSION_KEY]: "wakeups.permissionError",
    },
    mutationFn: (input: IssueWakeupInput) => api.createIssueWakeup(issueId, input),
    onSettled: () => invalidateIssueWakeups(queryClient, wsId, issueId),
  });
}

/** Turn a rule back on. `revision` fences the write; `rearm` is required for a
 *  one-shot that already fired, and `at` sets a new time on an `at` rule. */
export function useEnableIssueWakeup(issueId: string) {
  const { settle, onError } = useWakeupMutation(issueId);
  return useMutation({
    meta: {
      [WRITE_FAILURE_TITLE_KEY]: "wakeups.enableError",
      [WRITE_FAILURE_CONFLICT_KEY]: "wakeups.conflictError",
      [WRITE_FAILURE_PERMISSION_KEY]: "wakeups.permissionError",
    },
    mutationFn: ({
      id,
      ...input
    }: {
      id: string;
      revision: number;
      at?: string;
      rearm?: boolean;
    }) => api.enableIssueWakeup(issueId, id, input),
    onError,
    onSettled: settle,
  });
}

/** Stop a rule. Sends no revision — see `canDisableWakeup` for why that
 *  matters: stopping a misbehaving rule must not be gated on a field the
 *  client failed to read. */
export function useDisableIssueWakeup(issueId: string) {
  const { settle, onError } = useWakeupMutation(issueId);
  return useMutation({
    meta: {
      [WRITE_FAILURE_TITLE_KEY]: "wakeups.disableError",
      [WRITE_FAILURE_CONFLICT_KEY]: "wakeups.conflictError",
      [WRITE_FAILURE_PERMISSION_KEY]: "wakeups.permissionError",
    },
    mutationFn: (id: string) => api.disableIssueWakeup(issueId, id),
    onError,
    onSettled: settle,
  });
}

/** "Wake now" — one run of the rule, as if it fired. */
export function useTriggerIssueWakeup(issueId: string) {
  const { settle, onError } = useWakeupMutation(issueId);
  return useMutation({
    meta: {
      [WRITE_FAILURE_TITLE_KEY]: "wakeups.wakeNowError",
      [WRITE_FAILURE_CONFLICT_KEY]: "wakeups.conflictError",
      [WRITE_FAILURE_PERMISSION_KEY]: "wakeups.permissionError",
    },
    mutationFn: (id: string) => api.triggerIssueWakeup(issueId, id),
    onError,
    onSettled: settle,
  });
}

export function useDeleteIssueWakeup(issueId: string) {
  const { settle, onError } = useWakeupMutation(issueId);
  return useMutation({
    meta: {
      [WRITE_FAILURE_TITLE_KEY]: "wakeups.deleteError",
      [WRITE_FAILURE_CONFLICT_KEY]: "wakeups.conflictError",
      [WRITE_FAILURE_PERMISSION_KEY]: "wakeups.permissionError",
    },
    mutationFn: (id: string) => api.deleteIssueWakeup(issueId, id),
    onError,
    onSettled: settle,
  });
}

/** Rewrite a rule's prompt. `expected_instruction` travels with the revision
 *  because the server compares both. */
export function useEditWakeupInstruction(issueId: string) {
  const { settle, onError } = useWakeupMutation(issueId);
  return useMutation({
    meta: {
      [WRITE_FAILURE_TITLE_KEY]: "wakeups.instructionSaveError",
      [WRITE_FAILURE_CONFLICT_KEY]: "wakeups.conflictError",
      [WRITE_FAILURE_PERMISSION_KEY]: "wakeups.permissionError",
    },
    mutationFn: ({
      id,
      ...input
    }: {
      id: string;
      instruction: string;
      expected_instruction: string;
      revision: number;
    }) => api.editIssueWakeupInstruction(issueId, id, input),
    onError,
    onSettled: settle,
  });
}

/**
 * The platform's child-done rule on one issue.
 *
 * Omitted fields keep their value server-side, so flipping the switch sends
 * `enabled` alone and the instruction survives — which is why the toggle and
 * the editor are two calls to one hook rather than a read-modify-write.
 */
export function useUpdateIssueSystemWakeup(issueId: string) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const queryClient = useQueryClient();
  return useMutation({
    meta: {
      [WRITE_FAILURE_TITLE_KEY]: "wakeups.system.saveError",
      [WRITE_FAILURE_CONFLICT_KEY]: "wakeups.conflictError",
      [WRITE_FAILURE_PERMISSION_KEY]: "wakeups.permissionError",
    },
    mutationFn: ({
      rule,
      ...input
    }: {
      rule: SystemWakeup["rule"];
      enabled?: boolean;
      instruction?: string;
    }) => api.updateIssueSystemWakeup(issueId, rule, input),
    // The endpoint answers with the issue's whole rule list, so the response
    // IS the new state — seeded directly rather than followed by a refetch of
    // the same endpoint.
    onSuccess: (rules) => {
      if (!wsId) return;
      queryClient.setQueryData(issueKeys.systemWakeups(wsId, issueId), rules);
      // Turning the platform rule off withdraws runs that have not started, so
      // the issue's task list can have changed underneath the rows.
      void queryClient.invalidateQueries({
        queryKey: issueKeys.tasks(wsId, issueId),
      });
    },
    onError: (error) => {
      if (wakeupWriteNeedsRefresh(error) && wsId) {
        void queryClient.invalidateQueries({
          queryKey: issueKeys.systemWakeups(wsId, issueId),
        });
      }
    },
  });
}
