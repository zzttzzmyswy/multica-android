/**
 * Pure serializers for the autopilot create/edit form (shared by
 * `more/autopilots/new.tsx` and `more/autopilots/[id]/edit.tsx`), mirroring
 * web `autopilot-dialog.tsx` submit semantics. Kept free of React/RN so the
 * wire payloads are unit-testable.
 *
 * - `resolvedProjectId` — project binding is only meaningful when the run
 *   actually creates an issue; run_only autopilots always send null (web
 *   dialog parity).
 * - `serializedDescription` — create omits an empty description (undefined),
 *   edit clears it explicitly (null).
 * - `buildCreateAutopilotRequest` / `buildUpdateAutopilotRequest` — form
 *   state → validated wire bodies; assignee_type travels WITH assignee_id so
 *   a type swap (agent ↔ squad) never leaves the server guessing.
 */
import type {
  AutopilotAssigneeType,
  AutopilotExecutionMode,
  AutopilotSubscriberInput,
  CreateAutopilotRequest,
  UpdateAutopilotRequest,
} from "@multica/core/types";

/** Neutral form state — what `AutopilotForm` collects. */
export interface AutopilotFormValues {
  title: string;
  description: string;
  projectId: string | null;
  assigneeType: AutopilotAssigneeType;
  assigneeId: string;
  executionMode: AutopilotExecutionMode;
  subscriberUserIds: string[];
}

export function resolvedProjectId(
  executionMode: AutopilotExecutionMode,
  projectId: string | null,
): string | null {
  return executionMode === "create_issue" ? projectId : null;
}

export function serializedDescription(
  mode: "create",
  raw: string,
): string | undefined;
export function serializedDescription(
  mode: "edit",
  raw: string,
): string | null;
export function serializedDescription(
  mode: "create" | "edit",
  raw: string,
): string | undefined | null {
  const value = raw.trim();
  if (mode === "create") return value || undefined;
  return value || null;
}

function toSubscribers(ids: string[]): AutopilotSubscriberInput[] {
  return ids.map((user_id) => ({ user_type: "member" as const, user_id }));
}

export function buildCreateAutopilotRequest(
  v: AutopilotFormValues,
): CreateAutopilotRequest {
  return {
    title: v.title.trim(),
    description: serializedDescription("create", v.description),
    project_id: resolvedProjectId(v.executionMode, v.projectId),
    assignee_type: v.assigneeType,
    assignee_id: v.assigneeId,
    execution_mode: v.executionMode,
    subscribers: toSubscribers(v.subscriberUserIds),
  };
}

export function buildUpdateAutopilotRequest(
  id: string,
  v: AutopilotFormValues,
): { id: string } & UpdateAutopilotRequest {
  return {
    id,
    title: v.title.trim(),
    description: serializedDescription("edit", v.description),
    project_id: resolvedProjectId(v.executionMode, v.projectId),
    assignee_type: v.assigneeType,
    assignee_id: v.assigneeId,
    execution_mode: v.executionMode,
    subscribers: toSubscribers(v.subscriberUserIds),
  };
}