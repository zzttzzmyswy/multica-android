import { queryOptions } from "@tanstack/react-query";
import { api } from "@/shared/api";

export const issueKeys = {
  all: (wsId: string) => ["issues", wsId] as const,
  list: (wsId: string) => [...issueKeys.all(wsId), "list"] as const,
  detail: (wsId: string, id: string) =>
    [...issueKeys.all(wsId), "detail", id] as const,
  timeline: (issueId: string) => ["issues", "timeline", issueId] as const,
  reactions: (issueId: string) => ["issues", "reactions", issueId] as const,
  subscribers: (issueId: string) =>
    ["issues", "subscribers", issueId] as const,
};

/**
 * CACHE SHAPE NOTE: The raw cache stores ListIssuesResponse ({ issues, total }),
 * but `select` transforms it to Issue[] for consumers. Mutations and ws-updaters
 * must use setQueryData<ListIssuesResponse>(...) — NOT setQueryData<Issue[]>.
 */
export function issueListOptions(wsId: string) {
  return queryOptions({
    queryKey: issueKeys.list(wsId),
    queryFn: () => api.listIssues({ limit: 200 }),
    select: (data) => data.issues,
  });
}

export function issueDetailOptions(wsId: string, id: string) {
  return queryOptions({
    queryKey: issueKeys.detail(wsId, id),
    queryFn: () => api.getIssue(id),
  });
}

export function issueTimelineOptions(issueId: string) {
  return queryOptions({
    queryKey: issueKeys.timeline(issueId),
    queryFn: () => api.listTimeline(issueId),
  });
}

export function issueReactionsOptions(issueId: string) {
  return queryOptions({
    queryKey: issueKeys.reactions(issueId),
    queryFn: async () => {
      const issue = await api.getIssue(issueId);
      return issue.reactions ?? [];
    },
  });
}

export function issueSubscribersOptions(issueId: string) {
  return queryOptions({
    queryKey: issueKeys.subscribers(issueId),
    queryFn: () => api.listIssueSubscribers(issueId),
  });
}
