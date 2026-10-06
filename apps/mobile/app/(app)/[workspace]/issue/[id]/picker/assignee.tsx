/**
 * Assignee picker route for an existing issue.
 *
 * Search lives in the iOS native nav header when the sheet keeps its header
 * (registered in `../_layout.tsx` with `headerShown: true` + title), and in
 * the body everywhere else — Android never renders the native search bar.
 * `usePickerSearch` makes that choice; `PickerBodyShell` renders it.
 */
import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { AssigneePickerBody } from "@/components/issue/pickers/assignee-picker-body";
import { PickerBodyShell } from "@/components/pickers/picker-body-shell";
import { issueDetailOptions } from "@/data/queries/issues";
import { useUpdateIssue } from "@/data/mutations/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { usePickerSearch } from "@/lib/use-picker-search";
import { useTranslation } from "@/lib/i18n/react";

export default function IssueAssigneePickerRoute() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: issue } = useQuery(issueDetailOptions(wsId, id));
  const updateIssue = useUpdateIssue(id);
  const search = usePickerSearch(t("picker.searchPeople"), {
    autoFocus: true,
    nativeHeader: true,
  });

  const value =
    issue?.assignee_type && issue?.assignee_id
      ? { type: issue.assignee_type, id: issue.assignee_id }
      : null;

  return (
    <PickerBodyShell search={search} title={t("screen.assignee")}>
      <AssigneePickerBody
        value={value}
        query={search.query}
        onChange={(next) => {
          if (next === null) {
            updateIssue.mutate({ assignee_type: null, assignee_id: null });
          } else {
            updateIssue.mutate({
              assignee_type: next.type,
              assignee_id: next.id,
            });
          }
          router.back();
        }}
      />
    </PickerBodyShell>
  );
}
