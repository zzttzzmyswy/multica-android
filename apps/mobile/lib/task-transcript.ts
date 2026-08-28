import type { AgentTask } from "@multica/core/types";

/**
 * Whether a task row may open the execution-transcript view. Mirrors web
 * `activity-tab.tsx`'s `showTranscript = task.status !== "queued"` — queued
 * tasks carry no messages yet, so the entry is hidden rather than opening an
 * empty transcript.
 */
export function isTranscriptViewable(status: AgentTask["status"]): boolean {
  return status !== "queued";
}