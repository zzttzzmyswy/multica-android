import { queryOptions, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "@/data/api";
import { useWorkspaceStore } from "@/data/workspace-store";
import { deriveRunningIssueIds } from "@/lib/running-issues";

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
