/**
 * Edit-property route. Looks the definition up from the workspace property
 * catalog cache and renders the shared form in edit mode, where the save
 * button updates via PATCH and an archive/restore row confirms then flips
 * the definition. Not-found / loading / error states guard against deep
 * links to a missing definition.
 */
import { ActivityIndicator, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { PropertyForm } from "@/components/property/property-form";
import { propertyCatalogOptions } from "@/data/queries/properties";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

export default function EditPropertyPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data, isLoading, error, refetch } = useQuery(propertyCatalogOptions(wsId));
  const property = (data ?? []).find((p) => p.id === id);

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
          {t("properties.loadError")}
          {error instanceof Error ? error.message : t("common.unknownError")}
        </Text>
        <Button variant="outline" onPress={() => refetch()}>
          <Text>{t("workspace.retry")}</Text>
        </Button>
      </View>
    );
  }

  if (!property) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6 gap-1">
        <Ionicons name="options-outline" size={32} color={muted} />
        <Text className="text-sm text-muted-foreground text-center mt-2">
          {t("properties.notFound")}
        </Text>
      </View>
    );
  }

  return <PropertyForm property={property} />;
}