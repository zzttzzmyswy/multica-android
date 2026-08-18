/**
 * Mobile CustomStatusChip — mirrors web's
 * `packages/views/issues/components/custom-status-chip.tsx` (MUL-6243).
 *
 * Board columns and list sections are CATEGORIES, so two issues sitting in the
 * same "In Review" column can be on different statuses — "Code Review" and
 * "QA" — with nothing on the card to tell them apart. The chip is that missing
 * signal, and it renders NOTHING for a status that already is its category's
 * built-in: the column header already says "In Review", so a workspace that
 * never defined a custom status sees no visual change at all.
 */
import { View } from "react-native";
import type {
  IssueStatus,
  IssueStatusCategory,
} from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { useIssueStatuses } from "@/data/queries/issue-statuses";
import { StatusIcon } from "@/components/ui/status-icon";

/** Pure predicate behind the chip, testable in the Node lane. */
export function isCustomStatus(
  entry: { is_system?: boolean; category?: IssueStatusCategory } | undefined,
  status: IssueStatus,
  categoryOf: (statusKey: string) => IssueStatusCategory,
): boolean {
  if (!entry) return false;
  // `is_system` is the authority; the key comparison covers the window before
  // the catalog lands, where a built-in must still stay silent.
  return entry.is_system !== true && status !== categoryOf(status);
}

/**
 * Whether {@link CustomStatusChip} would render something for this status —
 * layouts that wrap the chip in a container use this to skip empty rows.
 */
export function useIsCustomStatus(
  status: IssueStatus,
  wsId?: string | null,
): boolean {
  const { entryOf, categoryOf } = useIssueStatuses(wsId ?? null);
  return isCustomStatus(entryOf(status), status, categoryOf);
}

export function CustomStatusChip({
  status,
  wsId,
  className,
}: {
  status: IssueStatus;
  wsId?: string | null;
  className?: string;
}) {
  const catalog = useIssueStatuses(wsId ?? null);
  const entry = catalog.entryOf(status);
  if (!isCustomStatus(entry, status, catalog.categoryOf) || !entry) return null;

  return (
    <View
      className={`flex-row items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5 ${className ?? ""}`}
    >
      <StatusIcon
        status={status}
        category={entry.category}
        color={entry.color}
        size={12}
      />
      <Text className="text-[10px] leading-tight text-muted-foreground" numberOfLines={1}>
        {entry.name}
      </Text>
    </View>
  );
}