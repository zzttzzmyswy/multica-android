/**
 * Start-date picker route for the in-progress new-issue draft. Mirrors
 * `./due-date.tsx` exactly — same `DatePickerSheet` — writing into the draft's
 * `startDate` instead of `dueDate`. start_date uses the same "YYYY-MM-DD"
 * calendar-day convention as due_date (see `@multica/core/issues/date`), so
 * the sheet is shared as-is.
 */
import { router } from "expo-router";
import { DatePickerSheet } from "@/components/issue/pickers/date-picker-sheet";
import { useNewIssueDraftStore } from "@/data/stores/new-issue-draft-store";
import { useTranslation } from "@/lib/i18n/react";

export default function NewIssueStartDatePickerRoute() {
  const { t } = useTranslation();
  const startDate = useNewIssueDraftStore((s) => s.startDate);
  const setStartDate = useNewIssueDraftStore((s) => s.setStartDate);

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
