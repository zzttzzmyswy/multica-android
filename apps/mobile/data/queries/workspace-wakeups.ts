/**
 * The workspace-level wakeup reads (MYS-2043), mirroring web's
 * `packages/core/issues/wakeups.ts` on the two surfaces this round ports:
 *
 *   - `workspaceWakeupsOptions` — one page of the cross-issue rule table behind
 *     web's 自动化 → 任务唤醒 tab (`GET /api/issue-wakeups`).
 *   - `workspaceSystemWakeupsOptions` — the platform rule's workspace DEFAULT,
 *     behind web's 设置 → 唤醒 tab (`GET /api/system-wakeups`).
 *
 * The per-issue reads in `issue-wakeups.ts` stay where they are: different
 * endpoints, different cache keys, and this round does not touch them.
 *
 * **Why these do not poll.** Web re-reads its table every 10s
 * (`workspaceWakeupsOptions`'s `refetchInterval`). Mobile deliberately does not,
 * for the reason already recorded in `issue-wakeups.ts`: a device smoke run
 * showed a 10s wakeup poll timing out at 30s over the wireless adb link and
 * starving `/api/inbox`, `/api/runtimes` and `/api/issue-statuses` in the same
 * window. A table of 136 rules is the largest read in the subsystem, so it is
 * the last one that should be on a timer. Instead: fetch on mount, refetch on
 * pull-to-refresh, and invalidate the table's own key after every write from
 * this app (see `data/mutations/workspace-wakeups.ts`) — which is the case
 * where the data the user is looking at actually changed.
 */
import { queryOptions } from "@tanstack/react-query";
import type { WorkspaceWakeupFilters } from "@multica/core/types";
import { api } from "@/data/api";
import { issueKeys } from "./issue-keys";

/**
 * How long a read stays fresh.
 *
 * Longer than the per-issue reads' 30s: this table is a browse surface, not a
 * control surface. A reader who opens it, reads it, and comes back a minute
 * later wants the same rows, not a refetch of 136 rules.
 */
const WORKSPACE_WAKEUP_STALE_MS = 60_000;

/**
 * One page of the workspace-wide rule table.
 *
 * The filters are part of the key, so paging and every filter change get their
 * own cached page and going "back" a page is instant. It also means a stale
 * page can be shown while the next one loads — which is why the filter state
 * carries `offset` and `limit` rather than the query taking them separately:
 * one object, one key, no way to change the page without the key changing.
 */
export const workspaceWakeupsOptions = (
  wsId: string | null,
  filters: WorkspaceWakeupFilters,
) =>
  queryOptions({
    queryKey: issueKeys.workspaceWakeups(wsId, filters),
    queryFn: ({ signal }) => api.listWorkspaceWakeups(filters, { signal }),
    enabled: !!wsId,
    staleTime: WORKSPACE_WAKEUP_STALE_MS,
  });

/**
 * The platform rule's workspace default.
 *
 * No `staleTime` by default, unlike the table: this is a two-row settings read
 * that an admin edits, and a default that changed on another device should not
 * be shown as current on this one for a minute. The read is tiny.
 */
export const workspaceSystemWakeupsOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: issueKeys.workspaceSystemWakeups(wsId),
    queryFn: ({ signal }) => api.listWorkspaceSystemWakeups({ signal }),
    enabled: !!wsId,
  });
