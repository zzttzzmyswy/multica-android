/**
 * Edit-label route. Looks the label up from the workspace label list cache
 * (there is no standalone label detail endpoint client-side; the list is the
 * management surface) and renders the shared form in edit mode, where the
 * save button updates via PUT and a destructive Delete row confirms then
 * DELETEs. Not-found / loading / error states guard against deep links to a
 * missing or not-yet-fetched label.
 */
import { ActivityIndicator, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { LabelForm } from "@/components/label/label-form";
import { labelListOptions } from "@/data/queries/labels";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

export default function EditLabelPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data, isLoading, error, refetch } = useQuery(labelListOptions(wsId));
  const label = (data ?? []).find((l) => l.id === id);

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
          {t("labels.loadError")}
          {error instanceof Error ? error.message : t("common.unknownError")}
        </Text>
        <Button variant="outline" onPress={() => refetch()}>
          <Text>{t("workspace.retry")}</Text>
        </Button>
      </View>
    );
  }

  if (!label) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6 gap-1">
        <Ionicons name="pricetags-outline" size={32} color={muted} />
        <Text className="text-sm text-muted-foreground text-center mt-2">
          {t("labels.notFound")}
        </Text>
      </View>
    );
  }

  // The parent only renders this branch once the label is loaded, so the
  // form's initial useState prefill sees the label on first mount — no key
  // remount needed.
  return <LabelForm label={label} />;
}