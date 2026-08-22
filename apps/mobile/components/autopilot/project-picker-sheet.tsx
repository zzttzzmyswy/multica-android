/**
 * Single-select project picker sheet for the autopilot form. Mirrors web's
 * ProjectPicker semantics: a "no project" sentinel row on top, then each
 * project; picking one closes immediately. Unlike the issue detail picker it
 * stays in a Modal (the form is a push screen and nothing else needs the
 * value) instead of a stacked route.
 */
import { Modal, Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Project } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ProjectIcon } from "@/components/ui/project-icon";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/react";

interface Props {
  visible: boolean;
  projects: Project[];
  selectedProjectId: string | null;
  onPick: (projectId: string | null) => void;
  onClose: () => void;
}

export function ProjectPickerSheet({
  visible,
  projects,
  selectedProjectId,
  onPick,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const checkColor =
    colorScheme === "dark" ? THEME.dark.primary : THEME.light.primary;

  const rows = [...projects]
    .filter((p) => p.title.trim())
    .sort((a, b) => a.title.localeCompare(b.title));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable className="flex-1 bg-black/40" onPress={onClose}>
        <View className="flex-1 items-center justify-center px-6">
          <Pressable onPress={() => {}} className="w-full max-w-sm">
            <View className="bg-popover rounded-2xl overflow-hidden">
              <View className="px-4 py-3 border-b border-border">
                <Text className="text-base font-semibold text-foreground">
                  {t("autopilots.projectPicker.title")}
                </Text>
              </View>

              <ScrollView className="max-h-96">
                <Pressable
                  onPress={() => {
                    onPick(null);
                    onClose();
                  }}
                  className={cn(
                    "flex-row items-center gap-3 px-4 py-3 active:bg-secondary",
                    selectedProjectId === null && "bg-secondary/60",
                  )}
                >
                  <View className="h-7 w-7 items-center justify-center rounded-md bg-muted">
                    <Ionicons
                      name="close-circle-outline"
                      size={18}
                      color={THEME[colorScheme].mutedForeground}
                    />
                  </View>
                  <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
                    {t("autopilots.new.noProject")}
                  </Text>
                  {selectedProjectId === null ? (
                    <Ionicons name="checkmark" size={20} color={checkColor} />
                  ) : null}
                </Pressable>

                {rows.length === 0 ? (
                  <View className="px-3 py-8 items-center">
                    <Text className="text-sm text-muted-foreground text-center">
                      {t("picker.noProjects")}
                    </Text>
                  </View>
                ) : (
                  rows.map((project) => {
                    const selected = project.id === selectedProjectId;
                    return (
                      <Pressable
                        key={project.id}
                        onPress={() => {
                          onPick(project.id);
                          onClose();
                        }}
                        className={cn(
                          "flex-row items-center gap-3 px-4 py-3 active:bg-secondary",
                          selected && "bg-secondary/60",
                        )}
                      >
                        <ProjectIcon icon={project.icon} size="md" />
                        <Text
                          className="flex-1 text-sm text-foreground"
                          numberOfLines={1}
                        >
                          {project.title}
                        </Text>
                        {selected ? (
                          <Ionicons name="checkmark" size={20} color={checkColor} />
                        ) : null}
                      </Pressable>
                    );
                  })
                )}
              </ScrollView>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}