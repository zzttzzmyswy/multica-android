import { queryOptions, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "@/data/api";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  deriveIssueSurfaceActivity,
  deriveRunningIssueIds,
} from "@/lib/running-issues";

// Workspace agent task snapshot — every active task plus each agent's most
// recent terminal task. Feeds the workload dimension of presence. Mobile
// invalidates on task lifecycle events (queued/dispatch/completed/failed/
// cancelled) but DELIBERATELY skips task:progress and task:message — those
// fire many times per active task and would invalidate-storm cellular data.
// See data/realtime/use-presence-realtime.ts.
export const agentTaskSnapshotOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: ["agent-task-snapshot", wsId] as const,
    queryFn: ({ signal }) => api.listAgentTaskSnapshot({ signal }),
    enabled: !!wsId,
  });

/**
 * The running-issue projection as a hook, for surfaces that filter on the
 * "agents working now" predicate. The projection itself lives in
 * `lib/running-issues.ts` so it stays testable without the native chain.
 *
 * Returns `undefined` while the snapshot is unresolved — the caller needs
 * that distinction, because `applyIssueFilters` fails closed on an
 * unresolved set (hides everything) but treats a resolved empty set as a
 * real "nobody is working" answer. Collapsing the two here would make the
 * list flash empty on every cold open.
 */
export function useRunningIssueIds(): ReadonlySet<string> | undefined {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data } = useQuery(agentTaskSnapshotOptions(wsId));
  return useMemo(
    () => (data === undefined ? undefined : deriveRunningIssueIds(data)),
    [data],
  );
}

/**
 * The RUNNING-OR-QUEUED projection — every issue an agent has a non-terminal
 * task on, read by the inbox's "no agents working" dimension.
 *
 * Deliberately not `useRunningIssueIds` above. That one answers the issue
 * list's "agents working right now" question, which excludes queued /
 * dispatched / waiting tasks on purpose. The inbox dimension asks something
 * else — "is anyone going to work on this?" — and web answers it with the full
 * `activityByIssueId` key set (`inbox-page.tsx`), queued included. Sharing the
 * running-only set would make an issue whose task was just dispatched read as
 * idle on the phone and busy on the web, for the same notification.
 *
 * `undefined` while the snapshot is unresolved, for the same reason as above:
 * `filterInboxItems` fails closed on an unresolved set rather than treating
 * it as "nobody is working".
 */
export function useIssueActivityIssueIds(): ReadonlySet<string> | undefined {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data } = useQuery(agentTaskSnapshotOptions(wsId));
  return useMemo(
    () =>
      data === undefined
        ? undefined
        : new Set(deriveIssueSurfaceActivity(data).activityByIssueId.keys()),
    [data],
  );
}
