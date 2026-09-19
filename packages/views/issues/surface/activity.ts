"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { agentTaskSnapshotOptions } from "@multica/core/agents";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  deriveIssueSurfaceActivity,
  type IssueSurfaceActivity,
} from "@multica/core/issues/surface/issue-activity";

// The pure projections live in core — mobile's issue rows and inbox rows draw
// the same lines and cannot import `@multica/views`. Re-exported here so the
// existing `../surface/activity` import paths keep resolving to one source.
export {
  deriveIssueSurfaceActivity,
  deriveRunningIssueIds,
  isQueuedTaskStatus,
  selectIssueTasks,
  summarizeIssueActivity,
  type IssueActivityState,
  type IssueAgentActivity,
  type IssueAgentActivityState,
  type IssueSurfaceActivity,
  type IssueTaskGroups,
} from "@multica/core/issues/surface/issue-activity";

export function useIssueSurfaceActivity(): IssueSurfaceActivity {
  const wsId = useWorkspaceId();
  const { data: snapshot = [] } = useQuery(agentTaskSnapshotOptions(wsId));
  return useMemo(() => deriveIssueSurfaceActivity(snapshot), [snapshot]);
}
