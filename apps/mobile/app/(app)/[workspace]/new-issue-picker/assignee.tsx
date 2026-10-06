/**
 * Assignee picker route for the in-progress new-issue draft. See ./status.tsx.
 *
 * Search lives in the iOS native nav header when the sheet keeps its header
 * (registered in `_layout.tsx` with `headerShown: true` + title), and in the
 * body everywhere else — Android never renders the native search bar.
 */
import { router } from "expo-router";
import { AssigneePickerBody } from "@/components/issue/pickers/assignee-picker-body";
import { PickerBodyShell } from "@/components/pickers/picker-body-shell";
import { useNewIssueDraftStore } from "@/data/stores/new-issue-draft-store";
import { usePickerSearch } from "@/lib/use-picker-search";
import { useTranslation } from "@/lib/i18n/react";

export default function NewIssueAssigneePickerRoute() {
  const { t } = useTranslation();
  const assignee = useNewIssueDraftStore((s) => s.assignee);
  const setAssignee = useNewIssueDraftStore((s) => s.setAssignee);
  const search = usePickerSearch(t("picker.searchPeople"), {
    autoFocus: true,
    nativeHeader: true,
  });

  return (
    <PickerBodyShell search={search} title={t("screen.assignee")}>
      <AssigneePickerBody
        value={assignee}
        query={search.query}
        onChange={(next) => {
          setAssignee(next);
          router.back();
        }}
      />
    </PickerBodyShell>
  );
}
