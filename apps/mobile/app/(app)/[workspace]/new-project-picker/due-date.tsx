/**
 * Due-date picker route for the in-progress new-project draft. See
 * `./start-date.tsx` — same sheet, same calendar-day convention, writing
 * `dueDate` instead of `startDate`.
 */
import { router } from "expo-router";
import { DatePickerSheet } from "@/components/issue/pickers/date-picker-sheet";
import { useNewProjectDraftStore } from "@/data/stores/new-project-draft-store";
import { useTranslation } from "@/lib/i18n/react";

export default function NewProjectDueDatePickerRoute() {
  const { t } = useTranslation();
  const dueDate = useNewProjectDraftStore((s) => s.dueDate);
  const setDueDate = useNewProjectDraftStore((s) => s.setDueDate);

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
