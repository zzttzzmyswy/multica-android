/**
 * Property edit route (MYS-668). Owns rename / re-option / archive / restore
 * through `PropertyForm` (which pushes its own Stack.Screen). Looks the id up
 * in the include-archived catalog so archived definitions can still be
 * reopened; pinned-loading shows a spinner, a missing id renders a not-found
 * state instead of crashing.
 */
import { ActivityIndicator, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { PropertyForm } from "@/components/property/property-form";
import { propertyCatalogOptions } from "@/data/queries/properties";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

export default function EditPropertyPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;

  const { data, isLoading } = useQuery(propertyCatalogOptions(wsId));
  const property = (data ?? []).find((p) => p.id === id);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (!property) {
    return (
      <View className="flex-1 items-center justify-center px-6 gap-2 bg-background">
        <Ionicons name="warning-outline" size={32} color={muted} />
        <Text className="text-sm text-muted-foreground text-center">
          {t("properties.notFound")}
        </Text>
      </View>
    );
  }

  return <PropertyForm property={property} />;
}