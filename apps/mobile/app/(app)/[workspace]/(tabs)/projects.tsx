/**
 * "Projects" bottom tab. The tab bar hides the native Stack header, so this
 * host draws its own `<Header>` (title + "+" create action) and reuses the
 * shared `<ProjectsScreen>` body — same view as the `more/projects` push
 * screen, no duplicated list logic.
 */
import { View } from "react-native";
import { Header } from "@/components/ui/header";
import { IconButton } from "@/components/ui/icon-button";
import {
  ProjectsScreen,
  useCreateProject,
} from "@/components/project/projects-screen";
import { useTranslation } from "@/lib/i18n/react";

export default function ProjectsTab() {
  const { t } = useTranslation();
  const onCreate = useCreateProject();

  return (
    <View className="flex-1 bg-background">
      <Header
        title={t("nav.projects")}
        right={
          <IconButton
            name="add"
            onPress={onCreate}
            accessibilityLabel={t("projects.newProject")}
          />
        }
      />
      <ProjectsScreen onCreate={onCreate} />
    </View>
  );
}