/**
 * Edit quick-action route. Looks the action up from the workspace quick-action
 * list cache and renders the shared form in edit mode, where the save button
 * updates via PATCH and archive/restore + delete rows live. Not-found /
 * loading / error states guard against deep links to a missing action.
 */
import { ActivityIndicator, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { QuickActionForm } from "@/components/quick-action/quick-action-form";
import { quickActionListOptions } from "@/data/queries/quick-actions";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

export default function EditQuickActionPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data, isLoading, error, refetch } = useQuery(
    quickActionListOptions(wsId, true),
  );
  const action = (data ?? []).find((a) => a.id === id);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6 gap-3">
        <Text className="text-sm text-destructive">
          {t("quickActions.loading")}
          {error instanceof Error ? error.message : t("common.unknownError")}
        </Text>
        <Button variant="outline" onPress={() => refetch()}>
          <Text>{t("workspace.retry")}</Text>
        </Button>
      </View>
    );
  }

  if (!action) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6 gap-1">
        <Ionicons name="flash-outline" size={32} color={muted} />
        <Text className="text-sm text-muted-foreground text-center mt-2">
          {t("quickActions.noResults")}
        </Text>
      </View>
    );
  }

  return <QuickActionForm action={action} />;
}