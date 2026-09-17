/**
 * Project due-date picker route — same `DatePickerSheet` as the start-date
 * sheet, writing `project.due_date` instead. Mirrors web's
 * ProjectDueDatePicker
 * (packages/views/projects/components/project-due-date-picker.tsx).
 */
import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { DatePickerSheet } from "@/components/issue/pickers/date-picker-sheet";
import { projectDetailOptions } from "@/data/queries/projects";
import { useUpdateProject } from "@/data/mutations/projects";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";

export default function ProjectDueDatePickerRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  const { data: project } = useQuery(projectDetailOptions(wsId, id));
  const updateProject = useUpdateProject(id);

  return (
    <DatePickerSheet
      title={t("projects.detail.dueDate")}
      value={project?.due_date ?? null}
      onCommit={(iso) => {
        updateProject.mutate({ due_date: iso });
        router.back();
      }}
      onClear={() => {
        updateProject.mutate({ due_date: null });
        router.back();
      }}
    />
  );
}
