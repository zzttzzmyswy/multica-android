/**
 * Activity-row text formatter. Subset of the web `formatActivity` in
 * packages/views/issues/components/issue-detail.tsx:95 — same actions,
 * localized via the shared zh/en dictionary (zh preferred, en fallback).
 *
 * Unknown actions fall through to the raw string in `entry.action`. NEVER
 * throw and NEVER drop the row — that's the API Response Compatibility rule
 * from repo-root CLAUDE.md (server may add new action enum values; older
 * mobile clients in the wild must render them as a generic fallback, not
 * crash).
 */
import type { TimelineEntry } from "@multica/core/types";
import { formatDateOnly } from "@multica/core/issues/date";
import { translate } from "./i18n";
import { issuePriorityLabel, issueStatusLabel } from "./issue-status";

function statusName(
  s: string | undefined,
  resolver?: (statusKey: string) => string,
): string {
  if (s) return resolver ? resolver(s) : issueStatusLabel(s);
  return "?";
}

function priorityName(p: string | undefined): string {
  if (p) return issuePriorityLabel(p);
  return "?";
}

// start_date / due_date are calendar days — format timezone-safely (no offset
// day shift). Mirrors web's formatActivity in issue-detail.tsx.
function shortDate(date: string | undefined): string {
  if (!date) return "?";
  return formatDateOnly(date, { month: "short", day: "numeric" }, "en-US");
}

export function formatActivity(
  entry: TimelineEntry,
  resolveActorName: (
    type: string | null | undefined,
    id: string | null | undefined,
  ) => string,
  statusLabel?: (statusKey: string) => string,
): string {
  const details = (entry.details ?? {}) as Record<string, string>;
  switch (entry.action) {
    case "created":
      return translate("activity.created");
    case "status_changed":
      return translate("activity.statusChanged", {
        from: statusName(details.from, statusLabel),
        to: statusName(details.to, statusLabel),
      });
    case "priority_changed":
      return translate("activity.priorityChanged", {
        from: priorityName(details.from),
        to: priorityName(details.to),
      });
    case "assignee_changed": {
      const isSelf =
        details.to_type === entry.actor_type &&
        details.to_id === entry.actor_id;
      if (isSelf) return translate("activity.selfAssigned");
      if (details.from_id && !details.to_id) return translate("activity.removedAssignee");
      const toName =
        details.to_id && details.to_type
          ? resolveActorName(details.to_type, details.to_id)
          : null;
      if (toName) return translate("activity.assignedTo", { name: toName });
      return translate("activity.changedAssignee");
    }
    case "start_date_changed": {
      if (!details.to) return translate("activity.removedStartDate");
      return translate("activity.setStartDate", { date: shortDate(details.to) });
    }
    case "due_date_changed": {
      if (!details.to) return translate("activity.removedDueDate");
      return translate("activity.setDueDate", { date: shortDate(details.to) });
    }
    case "title_changed":
      return translate("activity.renamed", {
        from: details.from ?? "?",
        to: details.to ?? "?",
      });
    case "description_updated":
      return translate("activity.updatedDescription");
    case "task_completed": {
      const n = entry.coalesced_count ?? 1;
      return translate(n > 1 ? "activity.completedTasks" : "activity.completedTask", {
        count: n,
      });
    }
    case "task_failed": {
      const n = entry.coalesced_count ?? 1;
      return translate(n > 1 ? "activity.failedTasks" : "activity.failedTask", {
        count: n,
      });
    }
    case "squad_leader_evaluated": {
      const reason = details.reason?.trim();
      switch (details.outcome) {
        case "action":
          return reason
            ? translate("activity.squadActionReason", { reason })
            : translate("activity.squadAction");
        case "no_action":
          return reason
            ? translate("activity.squadNoActionReason", { reason })
            : translate("activity.squadNoAction");
        case "failed":
          return reason
            ? translate("activity.squadFailedReason", { reason })
            : translate("activity.squadFailed");
        default:
          return translate("activity.squadTrigger");
      }
    }
    default:
      return entry.action ?? "";
  }
}

