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
import { formatIssueDate } from "./format-date";
import { translate } from "./i18n";
import { issuePriorityLabel, issueStatusLabel } from "./issue-status";
import {
  previewOf,
  wakeupPausedText,
  wakeupTrigger,
  WAKEUP_ACTIVITY_ACTIONS,
  type StoredWakeupPreview,
} from "./wakeup-presentation";

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
// day shift) and in the active app locale. Mirrors web's formatActivity in
// issue-detail.tsx.
function shortDate(date: string | undefined): string {
  if (!date) return "?";
  return formatIssueDate(date);
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
  // Wakeup actions read as their own sentences — the generic fallback would
  // print the enum (`wakeup_checkin`). Handled before the switch so the five
  // branches sit together and the switch below keeps its shape.
  if (WAKEUP_ACTIVITY_ACTIONS.has(entry.action ?? "")) {
    return formatWakeupActivity(
      entry,
      (entry.details ?? {}) as WakeupActivityDetails,
      resolveActorName,
      statusLabel,
    );
  }
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


/** The `details` bag a wakeup activity entry carries. Every field is optional:
 *  the server writes a different subset per action, and an entry stored by an
 *  older server must still render. */
interface WakeupActivityDetails {
  wakeup?: StoredWakeupPreview;
  rule?: "child_done";
  stage?: number;
  total?: number;
  target_type?: string;
  target_id?: string;
  /**
   * woke (a run), notified (a member), merged (joined a run already waiting to
   * start), acknowledged (the agent's own action; no run), none.
   */
  outcome?: "woke" | "notified" | "merged" | "acknowledged" | "none";
  events?: string[];
  actor_type?: string;
  actor_id?: string;
  woke?: boolean;
  reason?: "max_fires" | "loop" | "rate";
  limit?: number;
  note?: string;
}

/**
 * The sentence for one wakeup timeline entry. Mirrors web's
 * `formatWakeupActivity` (wakeup-activity.tsx:96) branch for branch, so a
 * phone and a browser describe the same entry the same way.
 *
 * Why this is not part of the `formatActivity` switch: the sentences need the
 * rule as it was when the entry was written, which means resolving actor names
 * out of a stored preview bag before choosing a string. Keeping it in one
 * function makes that a single, testable step.
 */
function formatWakeupActivity(
  entry: TimelineEntry,
  details: WakeupActivityDetails,
  resolveActorName: (
    type: string | null | undefined,
    id: string | null | undefined,
  ) => string,
  statusLabel?: (statusKey: string) => string,
): string {
  const getName = (type: string, id: string) =>
    resolveActorName(type, id) || id;
  const deps = {
    t: translate,
    statusLabel,
    actorName: (type: string, id: string) => getName(type, id),
  };
  const preview = details.wakeup
    ? previewOf(details.wakeup, (type, id) => getName(type, id))
    : null;
  const condition = preview ? wakeupTrigger(deps, preview) : "";
  const agent = preview?.agent_name ?? "";
  switch (entry.action) {
    case "wakeup_created":
      return translate("activity.wakeupCreated", { condition, agent });
    case "wakeup_triggered": {
      if (details.rule === "child_done") {
        const count = details.total ?? 1;
        const closed = details.stage
          ? translate("activity.wakeupChildDoneStage", {
              stage: details.stage,
              count,
            })
          : translate("activity.wakeupChildDoneAll", { count });
        // The squad's leader ran, but the entry names the assignee people see.
        const name =
          details.target_type && details.target_id
            ? getName(details.target_type, details.target_id)
            : translate("activity.wakeupAssignee");
        const outcome =
          details.outcome ?? (details.target_type ? "woke" : "none");
        switch (outcome) {
          case "woke":
            return closed + translate("activity.wakeupChildDoneWoke", { name });
          case "notified":
            return (
              closed + translate("activity.wakeupChildDoneNotified", { name })
            );
          case "merged":
            return (
              closed + translate("activity.wakeupChildDoneMerged", { name })
            );
          case "acknowledged":
            return (
              closed +
              translate("activity.wakeupChildDoneAcknowledged", { name })
            );
          default:
            return closed;
        }
      }
      if (
        details.events?.length === 1 &&
        details.events[0] === "wakeup.manual" &&
        details.actor_id
      ) {
        return translate("activity.wakeupTriggeredManual", {
          name: getName("member", details.actor_id),
          agent,
        });
      }
      if (details.outcome === "merged")
        return translate("activity.wakeupTriggeredMerged", { condition, agent });
      if (details.outcome === "acknowledged")
        return translate("activity.wakeupTriggeredAcknowledged", {
          condition,
          agent,
        });
      return translate("activity.wakeupTriggered", { condition, agent });
    }
    case "wakeup_timed_out":
      return details.woke
        ? translate("activity.wakeupTimedOutWake", { condition, agent })
        : translate("activity.wakeupTimedOutEnd", { condition });
    case "wakeup_paused":
      // The reason is the whole content of this entry; the generic "paused"
      // sentence would drop why, which is what the reader needs.
      return (
        wakeupPausedText(deps, {
          paused_reason: details.reason ?? "rate",
          max_fires: details.limit ?? null,
          fire_count: details.limit ?? 0,
        }) ?? ""
      );
    case "wakeup_checkin": {
      const count = entry.coalesced_count ?? 1;
      const note = details.note ?? "";
      return count > 1
        ? translate("activity.wakeupCheckinCoalesced", { count, note })
        : translate("activity.wakeupCheckin", { note });
    }
    default:
      return entry.action ?? "";
  }
}
