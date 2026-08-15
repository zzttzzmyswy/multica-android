/**
 * Projects browse page (push screen). Title and `+` button live in the
 * native Stack header (declared here via `Stack.Screen options`); the list
 * body is the shared `<ProjectsScreen>` used by the "Projects" bottom-tab
 * too. Rendering an in-body title row on top of the native bar would stack
 * two "Projects" labels vertically, so only the tab host draws a `<Header>`.
 */
import { useCallback } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack } from "expo-router";
import { IconButton } from "@/components/ui/icon-button";
import { ProjectsScreen, useCreateProject } from "@/components/project/projects-screen";
import { useTranslation } from "@/lib/i18n/react";

export default function ProjectsPage() {
  const { t } = useTranslation();
  const onCreate = useCreateProject();

  const headerRight = useCallback(() => {
    return (
      <IconButton
        name="add"
        onPress={onCreate}
        accessibilityLabel={t("projects.newProject")}
      />
    );
  }, [onCreate, t]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={[]}>
      <Stack.Screen options={{ headerRight }} />
      <ProjectsScreen onCreate={onCreate} />
    </SafeAreaView>
  );
}