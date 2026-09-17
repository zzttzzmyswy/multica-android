/**
 * Project start-date picker route — presented as a formSheet by the parent
 * Stack. Same `DatePickerSheet` as the issue-side date sheets (start_date is
 * the same "YYYY-MM-DD" calendar-day convention — see
 * @multica/core/issues/date). Reads the project from cache and fires
 * useUpdateProject on confirm; mirrors web's ProjectStartDatePicker
 * (packages/views/projects/components/project-start-date-picker.tsx).
 */
import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { DatePickerSheet } from "@/components/issue/pickers/date-picker-sheet";
import { projectDetailOptions } from "@/data/queries/projects";
import { useUpdateProject } from "@/data/mutations/projects";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";

export default function ProjectStartDatePickerRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  const { data: project } = useQuery(projectDetailOptions(wsId, id));
  const updateProject = useUpdateProject(id);

  return (
    <DatePickerSheet
      title={t("projects.detail.startDate")}
      value={project?.start_date ?? null}
      onCommit={(iso) => {
        updateProject.mutate({ start_date: iso });
        router.back();
      }}
      onClear={() => {
        updateProject.mutate({ start_date: null });
        router.back();
      }}
    />
  );
}
