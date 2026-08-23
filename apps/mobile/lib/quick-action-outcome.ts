/**
 * Quick-action run-outcome copy — translates the per-target result of a run
 * (`comment.trigger_outcomes[0]`) into an honest one-line sentence. Mirrors
 * web's `outcomeMessage` (packages/views/issues/components/
 * quick-actions-section.tsx:140); "coalesced" means the click was accepted
 * but no NEW run started, so "Added to {name}'s current run" is the truth,
 * "{name} started working" is not.
 */
import type { CommentTriggerOutcome } from "@multica/core/types";

export type QuickActionOutcomeKind = "success" | "info" | "error";

export function quickActionOutcomeMessage(
  outcome: CommentTriggerOutcome | undefined,
  targetName: string,
  t: (key: string, params?: Record<string, string | number>) => string,
): { message: string; kind: QuickActionOutcomeKind } {
  if (!outcome) {
    // No outcome at all means the comment saved but nothing was reported —
    // surface it as neutral rather than claiming a run.
    return { message: t("issue.qa.posted"), kind: "info" };
  }
  switch (outcome.status) {
    case "queued":
      return {
        message: t("issue.qa.queued", { name: targetName }),
        kind: "success",
      };
    case "coalesced":
      return {
        message: t("issue.qa.coalesced", { name: targetName }),
        kind: "info",
      };
    case "deferred":
      return {
        message: t("issue.qa.deferred", { name: targetName }),
        kind: "info",
      };
    case "blocked":
      return {
        message: t("issue.qa.blockedRun", { name: targetName }),
        kind: "error",
      };
    default:
      // Server-driven enum: an unknown status must not be silently rendered
      // as success.
      return { message: t("issue.qa.posted"), kind: "info" };
  }
}