import type { QueryClient } from "@tanstack/react-query";
import { issueKeys } from "./queries";
import type { Issue } from "@/shared/types";
import type { ListIssuesResponse } from "@/shared/types";

export function onIssueCreated(
  qc: QueryClient,
  wsId: string,
  issue: Issue,
) {
  qc.setQueryData<ListIssuesResponse>(issueKeys.list(wsId), (old) =>
    old && !old.issues.some((i) => i.id === issue.id)
      ? { ...old, issues: [...old.issues, issue], total: old.total + 1 }
      : old,
  );
}

export function onIssueUpdated(
  qc: QueryClient,
  wsId: string,
  issue: Partial<Issue> & { id: string },
) {
  qc.setQueryData<ListIssuesResponse>(issueKeys.list(wsId), (old) =>
    old
      ? {
          ...old,
          issues: old.issues.map((i) =>
            i.id === issue.id ? { ...i, ...issue } : i,
          ),
        }
      : old,
  );
  qc.setQueryData<Issue>(issueKeys.detail(wsId, issue.id), (old) =>
    old ? { ...old, ...issue } : old,
  );
}

export function onIssueDeleted(
  qc: QueryClient,
  wsId: string,
  issueId: string,
) {
  qc.setQueryData<ListIssuesResponse>(issueKeys.list(wsId), (old) =>
    old
      ? {
          ...old,
          issues: old.issues.filter((i) => i.id !== issueId),
          total: old.total - 1,
        }
      : old,
  );
  qc.removeQueries({ queryKey: issueKeys.detail(wsId, issueId) });
  qc.removeQueries({ queryKey: issueKeys.timeline(issueId) });
  qc.removeQueries({ queryKey: issueKeys.reactions(issueId) });
  qc.removeQueries({ queryKey: issueKeys.subscribers(issueId) });
}
