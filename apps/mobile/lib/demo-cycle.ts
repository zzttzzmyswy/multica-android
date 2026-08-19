// @vitest-environment node
// Pure cycle helpers for the pre-auth demo page (app/(auth)/demo.tsx).
// Mirrors the web landing's mock-visual behaviour
// (apps/web/features/landing/components/features-section.tsx): the issue
// mock cycles through the same 5 statuses / 5 assignees the web visual
// uses, so both demos teach the same product semantics.
import type { IssuePriority, IssueStatus } from "@multica/core/types";

export const DEMO_STATUS_CYCLE: readonly IssueStatus[] = [
  "todo",
  "in_progress",
  "in_review",
  "done",
  "backlog",
];

export const DEMO_PRIORITY_CYCLE: readonly IssuePriority[] = [
  "none",
  "low",
  "medium",
  "high",
  "urgent",
];

export type DemoAssignee =
  | { kind: "unassigned" }
  | { kind: "member"; id: string; name: string; initials: string }
  | { kind: "agent"; id: string; name: string };

// Same roster as the web landing visual's allAssignees.
export const DEMO_ASSIGNEE_CYCLE: readonly DemoAssignee[] = [
  { kind: "unassigned" },
  { kind: "member", id: "ar", name: "Alex Rivera", initials: "AR" },
  { kind: "member", id: "sk", name: "Sarah Kim", initials: "SK" },
  { kind: "agent", id: "claude", name: "Claude" },
  { kind: "agent", id: "tina", name: "Tina-dev" },
];

/** Next step in a circular list; wraps around at the end. */
export function nextOfCycle<T>(cycle: readonly T[], current: T): T {
  const index = cycle.indexOf(current);
  return cycle[(index + 1) % cycle.length] ?? cycle[0];
}

export function nextStatus(current: IssueStatus): IssueStatus {
  return nextOfCycle(DEMO_STATUS_CYCLE, current);
}

export function nextPriority(current: IssuePriority): IssuePriority {
  return nextOfCycle(DEMO_PRIORITY_CYCLE, current);
}

export function nextAssignee(current: DemoAssignee): DemoAssignee {
  return nextOfCycle(DEMO_ASSIGNEE_CYCLE, current);
}