/**
 * Project lead picker route — presented as a formSheet by the parent Stack.
 * The sheet inherits `SHEET_OPTIONS` (`headerShown: false`), so the native
 * search bar would not mount on either platform — search is body-rendered.
 * Self-contained: reads project from cache, fires useUpdateProject directly.
 */
import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ProjectLeadPickerBody } from "@/components/project/pickers/project-lead-picker-body";
import { PickerBodyShell } from "@/components/pickers/picker-body-shell";
import { projectDetailOptions } from "@/data/queries/projects";
import { useUpdateProject } from "@/data/mutations/projects";
import { useWorkspaceStore } from "@/data/workspace-store";
import { usePickerSearch } from "@/lib/use-picker-search";
import { useTranslation } from "@/lib/i18n/react";

export default function ProjectLeadPickerRoute() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: project } = useQuery(projectDetailOptions(wsId, id));
  const updateProject = useUpdateProject(id);
  const search = usePickerSearch(t("picker.searchMembersOrAgents"), {
    autoFocus: true,
  });

  const value =
    project?.lead_type && project?.lead_id
      ? { type: project.lead_type, id: project.lead_id }
      : null;

  return (
    <PickerBodyShell search={search} title={t("picker.lead")}>
      <ProjectLeadPickerBody
        value={value}
        query={search.query}
        onChange={(next) => {
          if (next === null) {
            updateProject.mutate({ lead_type: null, lead_id: null });
          } else {
            updateProject.mutate({ lead_type: next.type, lead_id: next.id });
          }
          router.back();
        }}
      />
    </PickerBodyShell>
  );
}
