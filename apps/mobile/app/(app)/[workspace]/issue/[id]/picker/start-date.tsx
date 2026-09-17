/**
 * Start-date picker route for an existing issue.
 *
 * Existing-issue counterpart of `new-issue-picker/start-date.tsx` — the same
 * `DatePickerSheet` (quick picks + Done / Clear + day control), writing
 * `issue.start_date` instead of a draft. start_date is a calendar day in
 * the same "YYYY-MM-DD" convention as due_date (see
 * @multica/core/issues/date), so the sheet is shared as-is. Mirrors web's
 * optional-property `start_date` edit affordance
 * (packages/views/issues/components/issue-detail.tsx `OPTIONAL_PROP_KEYS`),
 * including the Today / Tomorrow / Next week shortcuts from the issue actions
 * menu.
 */
import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { DatePickerSheet } from "@/components/issue/pickers/date-picker-sheet";
import { issueDetailOptions } from "@/data/queries/issues";
import { useUpdateIssue } from "@/data/mutations/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";

export default function IssueStartDatePickerRoute() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: issue } = useQuery(issueDetailOptions(wsId, id));
  const updateIssue = useUpdateIssue(id);

  return (
    <DatePickerSheet
      title={t("startDate.title")}
      value={issue?.start_date ?? null}
      onCommit={(iso) => {
        updateIssue.mutate({ start_date: iso });
        router.back();
      }}
      onClear={() => {
        updateIssue.mutate({ start_date: null });
        router.back();
      }}
    />
  );
}
