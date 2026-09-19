/**
 * Due-date picker route for an existing issue.
 *
 * Reads as a plain `DatePickerSheet` call now that the header, the quick picks
 * and the calendar-day control live in one shared component — the route only
 * says which field it writes. Diverges from the other single-select pickers
 * because the native date control needs a confirmation step: spinning or
 * picking a day updates the sheet's draft, and Done commits it.
 */
import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { DatePickerSheet } from "@/components/issue/pickers/date-picker-sheet";
import { issueDetailOptions } from "@/data/queries/issues";
import { useUpdateIssue } from "@/data/mutations/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";

export default function IssueDueDatePickerRoute() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: issue } = useQuery(issueDetailOptions(wsId, id));
  const updateIssue = useUpdateIssue(id);

  return (
    <DatePickerSheet
      title={t("dueDate.title")}
      value={issue?.due_date ?? null}
      onCommit={(iso) => {
        updateIssue.mutate({ due_date: iso });
        router.back();
      }}
      onClear={() => {
        updateIssue.mutate({ due_date: null });
        router.back();
      }}
    />
  );
}
