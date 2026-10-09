/**
 * Wakeup-rule queries for one issue (MYS-2023), mirroring web's
 * `packages/core/issues/wakeups.ts` bound to mobile's ApiClient.
 *
 * Only the three read paths this round ships. Web's module also carries the
 * create / enable / disable / trigger / delete mutations and the workspace-wide
 * rule table; neither is ported here — see lib/wakeup-presentation.ts for why
 * the write surface is its own round.
 */
import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";
import { issueKeys } from "./issue-keys";

/**
 * How long a read stays fresh.
 *
 * Deliberately NOT a poll. Web re-reads these two every 10s, but web has one
 * tab on broadband; a phone on a weak link does not. A device smoke run over
 * the wireless adb link showed the 10s interval timing out at 30s and starving
 * the rest of the app — `/api/inbox`, `/api/runtimes`, `/api/squads` and
 * `/api/issue-statuses` were all logging 30s timeouts in the same window.
 *
 * Mobile's existing discipline (see data/realtime/use-issue-realtime.ts) is
 * fetch on mount, refresh on AppState focus, and invalidate on WS reconnect —
 * which is enough here, because the wakeup section mounts with the issue
 * detail and the reconnect hook now invalidates the wakeup keys too.
 */
const WAKEUP_STALE_MS = 30_000;

/** The rules people created on this issue. */
export const issueWakeupsOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: issueKeys.wakeups(wsId, id),
    queryFn: ({ signal }) => api.listIssueWakeups(id, { signal }),
    enabled: !!wsId && !!id,
    staleTime: WAKEUP_STALE_MS,
  });

/** The platform's rules on this issue (today: the child-done rule). */
export const issueSystemWakeupsOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: issueKeys.systemWakeups(wsId, id),
    queryFn: ({ signal }) => api.listIssueSystemWakeups(id, { signal }),
    enabled: !!wsId && !!id,
    staleTime: WAKEUP_STALE_MS,
  });

/**
 * One rule's trigger history. Fetched only when a reader opens the row that
 * needs it, so it carries no refresh of its own — the history of a rule that
 * already fired is settled, and a rule still waiting has nothing to add. It is
 * invalidated with the other wakeup keys on reconnect.
 */
export const issueWakeupRunsOptions = (
  wsId: string | null,
  id: string,
  wakeupId: string,
) =>
  queryOptions({
    queryKey: issueKeys.wakeupRuns(wsId, id, wakeupId),
    queryFn: ({ signal }) => api.listIssueWakeupRuns(id, wakeupId, { signal }),
    enabled: !!wsId && !!id && !!wakeupId,
    staleTime: WAKEUP_STALE_MS,
  });
