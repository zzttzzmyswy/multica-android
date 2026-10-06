/**
 * Project picker route for the in-progress new-issue draft. The sheet
 * inherits `SHEET_OPTIONS` (`headerShown: false`), so the native search bar
 * would not mount on either platform — search is body-rendered.
 */
import { router } from "expo-router";
import { ProjectPickerBody } from "@/components/issue/pickers/project-picker-body";
import { PickerBodyShell } from "@/components/pickers/picker-body-shell";
import { useNewIssueDraftStore } from "@/data/stores/new-issue-draft-store";
import { usePickerSearch } from "@/lib/use-picker-search";
import { useTranslation } from "@/lib/i18n/react";

export default function NewIssueProjectPickerRoute() {
  const { t } = useTranslation();
  const project = useNewIssueDraftStore((s) => s.project);
  const setProject = useNewIssueDraftStore((s) => s.setProject);
  const search = usePickerSearch(t("picker.searchProjects"), {
    autoFocus: true,
  });

  return (
    <PickerBodyShell search={search} title={t("attr.project")}>
      <ProjectPickerBody
        value={project}
        query={search.query}
        onChange={(next) => {
          setProject(next);
          router.back();
        }}
      />
    </PickerBodyShell>
  );
}
