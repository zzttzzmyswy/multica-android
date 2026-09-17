/**
 * Due-date picker route for the in-progress new-issue draft. See ./status.tsx.
 *
 * Same `DatePickerSheet` as the issue-detail variant
 * (`issue/[id]/picker/due-date.tsx`) — the native date control doesn't
 * auto-commit, so the sheet carries the quick picks and the Done / Clear
 * actions.
 */
import { router } from "expo-router";
import { DatePickerSheet } from "@/components/issue/pickers/date-picker-sheet";
import { useNewIssueDraftStore } from "@/data/stores/new-issue-draft-store";
import { useTranslation } from "@/lib/i18n/react";

export default function NewIssueDueDatePickerRoute() {
  const { t } = useTranslation();
  const dueDate = useNewIssueDraftStore((s) => s.dueDate);
  const setDueDate = useNewIssueDraftStore((s) => s.setDueDate);

  return (
    <DatePickerSheet
      title={t("dueDate.title")}
      value={dueDate}
      onCommit={(iso) => {
        setDueDate(iso);
        router.back();
      }}
      onClear={() => {
        setDueDate(null);
        router.back();
      }}
    />
  );
}
