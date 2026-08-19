/**
 * Mobile InboxDetailLabel — type-aware second-line for inbox rows.
 *
 * Mirrors packages/views/inbox/components/inbox-detail-label.tsx exactly:
 * for each InboxItemType the user sees the same label they would see on
 * web/desktop. This is a Behavioral parity concern — if web shows "Set
 * status to ✓ Done", mobile must show "Set status to ✓ Done" (rendered
 * with mobile primitives, not the literal HTML).
 *
 * Web is i18n-driven (useT). Mobile v1 is English-only; when mobile ships
 * i18n, mirror the namespace structure.
 */
import { View } from "react-native";
import type {
  InboxItem,
  InboxItemType,
  IssuePriority,
  IssueStatus,
} from "@multica/core/types";
import { formatDateOnly } from "@multica/core/issues/date";
import { Text } from "@/components/ui/text";
import { StatusIcon } from "@/components/ui/status-icon";
import { PriorityIcon } from "@/components/ui/priority-icon";
import { useActorLookup } from "@/data/use-actor-name";
import { cn } from "@/lib/utils";
import { issuePriorityLabel } from "@/lib/issue-status";
import { useStatusLabel } from "@/lib/status-options";
import { useIssueStatuses } from "@/data/queries/issue-statuses";
import { useTranslation } from "@/lib/i18n/react";

export function typeLabel(
  t: (id: string) => string,
  type: InboxItemType,
): string {
  return t(`inbox.type.${type}`);
}

// due_date is a calendar day — format timezone-safely (no offset day shift).
function shortDate(dateStr: string): string {
  return formatDateOnly(dateStr, { month: "short", day: "numeric" }, "en-US");
}

function singleLine(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function InboxDetailLabel({
  item,
  className,
}: {
  item: InboxItem;
  className?: string;
}) {
  const { getName } = useActorLookup();
  const { t } = useTranslation();
  const statusLabel = useStatusLabel();
  const statusCatalog = useIssueStatuses();
  const details = item.details ?? {};

  // Cases with inline icons → Row layout.
  if (item.type === "status_changed" && details.to) {
    const status = details.to as IssueStatus;
    const statusEntry = statusCatalog.entryOf(status);
    return (
      <View className={cn("flex-row items-center gap-1", className)}>
        <Text className="text-xs text-muted-foreground">{t("inbox.setStatusTo")}</Text>
        <StatusIcon
          status={status}
          category={statusEntry?.category}
          color={statusEntry?.is_system ? undefined : (statusEntry?.color ?? undefined)}
          size={12}
        />
        <Text className="text-xs text-muted-foreground" numberOfLines={1}>
          {statusLabel(status)}
        </Text>
      </View>
    );
  }

  if (item.type === "priority_changed" && details.to) {
    const priority = details.to as IssuePriority;
    return (
      <View className={cn("flex-row items-center gap-1", className)}>
        <Text className="text-xs text-muted-foreground">{t("inbox.setPriorityTo")}</Text>
        <PriorityIcon priority={priority} size={12} />
        <Text className="text-xs text-muted-foreground" numberOfLines={1}>
          {issuePriorityLabel(priority)}
        </Text>
      </View>
    );
  }

  // Single-string cases.
  const text = (() => {
    switch (item.type) {
      case "issue_assigned":
      case "assignee_changed":
        if (details.new_assignee_id) {
          const name = getName(
            (details.new_assignee_type ?? "member") as "member" | "agent",
            details.new_assignee_id,
          );
          return t("inbox.assignedTo", { name });
        }
        return typeLabel(t, item.type);
      case "unassigned":
        return t("inbox.removedAssignee");
      case "due_date_changed":
        return details.to
          ? t("inbox.setDueDate", { date: shortDate(details.to) })
          : t("inbox.removedDueDate");
      case "new_comment":
        return singleLine(item.body) || typeLabel(t, item.type);
      case "reaction_added":
        return details.emoji
          ? t("inbox.reacted", { emoji: details.emoji })
          : typeLabel(t, item.type);
      case "quick_create_done":
        return details.identifier
          ? t("inbox.createdWithAgent", { identifier: details.identifier })
          : typeLabel(t, item.type);
      case "quick_create_failed": {
        const detail = singleLine(details.error) || singleLine(item.body);
        return detail ? t("inbox.failedPrefix", { detail }) : typeLabel(t, item.type);
      }
      // Mirrors packages/views/inbox/components/inbox-detail-label.tsx: the
      // unconfirmed outcome deliberately drops the "Failed:" prefix, because
      // the issue may actually have been created.
      case "quick_create_unconfirmed": {
        const detail = singleLine(details.error) || singleLine(item.body);
        return detail || typeLabel(t, item.type);
      }
      default:
        return typeLabel(t, item.type) || item.type;
    }
  })();

  return (
    <Text
      className={cn("text-xs text-muted-foreground", className)}
      numberOfLines={1}
    >
      {text}
    </Text>
  );
}
