/**
 * Start-date picker route for the in-progress new-project draft. Mirrors
 * `new-issue-picker/start-date.tsx` — same `DatePickerSheet`, same
 * "YYYY-MM-DD" calendar-day convention (`@multica/core/issues/date`), writing
 * into the project draft instead of the issue draft.
 *
 * Web's create-project dialog offers start date as a pill alongside priority
 * (`create-project.tsx:637-648`); without it the phone forced a second trip
 * into the project after creation to set the schedule.
 */
import { router } from "expo-router";
import { DatePickerSheet } from "@/components/issue/pickers/date-picker-sheet";
import { useNewProjectDraftStore } from "@/data/stores/new-project-draft-store";
import { useTranslation } from "@/lib/i18n/react";

export default function NewProjectStartDatePickerRoute() {
  const { t } = useTranslation();
  const startDate = useNewProjectDraftStore((s) => s.startDate);
  const setStartDate = useNewProjectDraftStore((s) => s.setStartDate);

  return (
    <DatePickerSheet
      title={t("startDate.title")}
      value={startDate}
      onCommit={(iso) => {
        setStartDate(iso);
        router.back();
      }}
      onClear={() => {
        setStartDate(null);
        router.back();
      }}
    />
  );
}
