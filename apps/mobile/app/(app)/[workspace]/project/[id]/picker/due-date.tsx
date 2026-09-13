/**
 * Project due-date picker route — same calendar-day spinner + Done / Clear
 * header as the start-date sheet, writing `project.due_date` instead.
 * Mirrors web's ProjectDueDatePicker
 * (packages/views/projects/components/project-due-date-picker.tsx).
 */
import { useRef } from "react";
import { Pressable, View } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import {
  DueDatePickerBody,
  type DueDatePickerBodyHandle,
} from "@/components/issue/pickers/due-date-picker-body";
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
  const ref = useRef<DueDatePickerBodyHandle>(null);

  const value = project?.due_date ?? null;

  return (
    <View className="flex-1">
      <View className="flex-row items-center justify-between px-4 pt-4 pb-2">
        <Text className="text-base font-semibold text-foreground">
          {t("projects.detail.dueDate")}
        </Text>
        <View className="flex-row items-center gap-1">
          {value ? (
            <Pressable
              onPress={() => {
                updateProject.mutate({ due_date: null });
                router.back();
              }}
              hitSlop={6}
              className="px-2 py-1 rounded-md active:bg-secondary"
            >
              <Text className="text-sm text-destructive">{t("common.clear")}</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => {
              updateProject.mutate({ due_date: ref.current?.getIso() });
              router.back();
            }}
            hitSlop={6}
            className="px-2 py-1 rounded-md active:bg-secondary"
          >
            <Text className="text-sm font-medium text-primary">{t("common.done")}</Text>
          </Pressable>
        </View>
      </View>
      <DueDatePickerBody ref={ref} value={value} />
    </View>
  );
}
