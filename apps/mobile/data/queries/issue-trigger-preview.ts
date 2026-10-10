/**
 * The run-enqueue predicate preview — `POST /api/issues/preview-trigger`,
 * asked once by the new-issue form's "will start working" caption.
 *
 * One consumer, and the reason it is a query rather than a one-shot call: the
 * verdict changes only with the inputs (assignee / status), so keying on their
 * signature means picking the same agent twice costs nothing and switching
 * between two agents swaps the answer in place.
 *
 * Mirrors web's `useIssueTriggerPreview`
 * (`packages/views/issues/hooks/use-issue-trigger-preview.ts`) in the two ways
 * that decide what the caption reads:
 *
 *   - `keepPreviousData`, so an input switch swaps the verdict in place instead
 *     of collapsing the caption to nothing for a frame.
 *   - only the FIRST load (no prior data) counts as `isLoading`. A background
 *     refetch is not loading, or a caption already on screen would blink out
 *     and back on every refetch.
 *
 * `retry: false` matches web: the endpoint is advisory, and a failed preview
 * must resolve to "no answer" promptly rather than sit in a retry loop while
 * the user is looking at a form.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type {
  IssueAssigneeType,
  IssueStatus,
  IssueTriggerPreviewParams,
} from "@multica/core/types";
import { api } from "@/data/api";

export interface UseIssueTriggerPreviewParams {
  /** Preview the not-yet-persisted issue being created from the form. */
  isCreate?: boolean;
  assigneeType?: IssueAssigneeType | null;
  assigneeId?: string | null;
  status?: IssueStatus;
  /** Caller gate — keep the request off until the form can actually show a
   *  caption (an agent-like assignee is picked). */
  enabled?: boolean;
}

export interface UseIssueTriggerPreviewResult {
  /** `total_count` from the preview: how many runs this write would start. */
  willStart: boolean;
  /** First load only — see the module doc. */
  isLoading: boolean;
}

/** Order-insensitive, stable signature for the query key. The caller passes a
 *  fresh object every render, so keying on the object itself would refetch on
 *  every keystroke; this collapses it to the fields the verdict depends on. */
function previewSignature(params: UseIssueTriggerPreviewParams): string {
  return JSON.stringify({
    create: params.isCreate ?? false,
    at: params.assigneeType ?? null,
    aid: params.assigneeId ?? null,
    status: params.status ?? null,
  });
}

export function useIssueTriggerPreview(
  params: UseIssueTriggerPreviewParams,
): UseIssueTriggerPreviewResult {
  const isAgentLike =
    params.assigneeType === "agent" || params.assigneeType === "squad";
  const hasTarget = isAgentLike && !!params.assigneeId;
  const enabled = (params.enabled ?? true) && hasTarget;

  const previewQuery = useQuery({
    queryKey: ["issue-trigger-preview", previewSignature(params)] as const,
    queryFn: () => {
      const request: IssueTriggerPreviewParams = {
        ...(params.isCreate ? { isCreate: true } : {}),
        assigneeType: params.assigneeType ?? null,
        assigneeId: params.assigneeId ?? null,
        ...(params.status ? { status: params.status } : {}),
      };
      return api.previewIssueTrigger(request);
    },
    enabled,
    retry: false,
    staleTime: 0,
    placeholderData: keepPreviousData,
  });

  return {
    willStart: (previewQuery.data?.total_count ?? 0) > 0,
    isLoading: enabled && previewQuery.isLoading,
  };
}
