/**
 * Property edit route (MYS-668). Owns rename / re-option / archive / restore
 * through `PropertyForm` (which pushes its own Stack.Screen). Looks the id up
 * in the include-archived catalog so archived definitions can still be
 * reopened; pinned-loading shows a spinner, a missing id renders a not-found
 * state instead of crashing.
 */
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { PropertyForm } from "@/components/property/property-form";
import { usePropertyCatalog } from "@/data/queries/properties";
import { PropertyCatalogStatus } from "@/components/property/property-catalog-status";
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

  // Four-state read (MYS-1892): a failed catalog previously fell through to
  // the not-found branch, so a request that timed out was reported as 「未找到
  // 该属性」 for a property that exists. Loading and failure now keep the user
  // on the page with a retry.
  const catalog = usePropertyCatalog(wsId);
  const property = catalog.definitions.find((p) => p.id === id);

  if (!catalog.isResolved) {
    return (
      <View className="flex-1 justify-center bg-background">
        <PropertyCatalogStatus
          state={catalog.state}
          onRetry={catalog.retry}
          layout="centered"
        />
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