/**
 * Stage picker route for the in-progress new-issue draft. See ./status.tsx for
 * the draft-store rationale.
 *
 * Reached only when the form has a parent (web gates the picker on
 * `parentIssueId` — `create-issue.tsx:957`), because a stage orders an issue
 * against its SIBLINGS and means nothing on a root issue. The option ceiling
 * comes from the chosen parent's existing children, fetched here through the
 * same `issueChildrenOptions` the issue-detail stage picker uses — a parent
 * whose children already occupy Stage 4 must still be able to create Stage 5.
 *
 * The chosen stage lives in `new-issue-stage-pick-store` (tagged with the
 * parent it was chosen under), not in the persisted draft — web keeps this one
 * field in local state for the same reason. The create payload only sends it
 * when a parent is actually set (see `new-issue.tsx`, mirroring web's
 * `parentIssueId && stage != null` gate).
 */
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { StagePickerBody } from "@/components/issue/pickers/stage-picker-body";
import { issueChildrenOptions } from "@/data/queries/issues";
import { useNewIssueStagePickStore } from "@/data/stores/new-issue-stage-pick-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { maxSiblingStage } from "@/lib/issue-stage";

export default function NewIssueStagePickerRoute() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  // The parent is NOT in the draft store — `new-issue.tsx` owns it, seeded from
  // the route params that opened the modal. This sheet therefore cannot read
  // the parent from the store; it is passed in as a param by the attribute row
  // that opened it, which only renders when that parent exists.
  const { parentId } = useLocalSearchParams<{ parentId?: string }>();
  const stage = useNewIssueStagePickStore((s) => s.stageFor(parentId));
  const setStage = useNewIssueStagePickStore((s) => s.setStage);

  const { data: siblings = [] } = useQuery({
    ...issueChildrenOptions(wsId, parentId ?? ""),
    enabled: !!wsId && !!parentId,
  });

  return (
    <StagePickerBody
      value={stage}
      maxStage={maxSiblingStage(siblings)}
      onChange={(next) => {
        // No parent means no stage to write — a deep link into this sheet on a
        // rootless form must not record a value the create payload refuses to
        // send. Fall through to the close so the sheet is not stuck.
        if (parentId) setStage(parentId, next);
        router.back();
      }}
    />
  );
}
