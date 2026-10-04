/**
 * "Add property" list route for an existing issue (MYS-334) — presented as
 * a formSheet. Lists the workspace's active (non-archived) property
 * definitions the issue doesn't have a value for yet; tapping one pushes
 * the value editor formSheet (issue/[id]/picker/property) on top.
 */
import { useMemo } from "react";
import { FlatList, Pressable, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { issueDetailOptions } from "@/data/queries/issues";
import { usePropertyCatalog } from "@/data/queries/properties";
import { PropertyCatalogStatus } from "@/components/property/property-catalog-status";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  propertyOptions,
  propertyTypeIcon,
  propertyTypeLabelKey,
} from "@/lib/issue-properties";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

export default function IssuePropertyAddRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;

  const { data: issue } = useQuery(issueDetailOptions(wsId, id));
  // Four-state read (MYS-1892): `isLoading` alone could not tell a failed
  // catalog from a settled one, so a timeout painted 「没有更多可添加的属性」 —
  // a claim that nothing is left to add, made without ever having read the
  // list. Each state now renders its own truth, and a failure offers a retry.
  const catalog = usePropertyCatalog(wsId);

  const available = useMemo(() => {
    const set = issue?.properties ?? {};
    return catalog.definitions.filter(
      (p) => !p.archived && set[p.id] === undefined,
    );
  }, [catalog.definitions, issue?.properties]);

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

  return (
    <View className="flex-1 bg-background">
      <Text className="px-4 pt-4 pb-2 text-base font-semibold text-foreground">
        {t("properties.value.addProperty")}
      </Text>
      <FlatList
        data={available}
        keyExtractor={(item) => item.id}
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        ItemSeparatorComponent={() => <View className="h-px bg-border ml-4" />}
        ListEmptyComponent={
          <View className="px-3 py-8 items-center">
            <Text className="text-sm text-muted-foreground text-center">
              {t("properties.value.noneAvailable")}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => {
              if (!wsSlug) return;
              router.push({
                pathname: "/[workspace]/issue/[id]/picker/property",
                params: {
                  workspace: wsSlug,
                  id,
                  propertyId: item.id,
                },
              });
            }}
            className="flex-row items-center gap-3 px-4 py-3 active:bg-secondary"
          >
            <View className="size-8 rounded-md bg-secondary items-center justify-center">
              <Ionicons
                name={propertyTypeIcon(item.type)}
                size={16}
                color={muted}
              />
            </View>
            <View className="flex-1 min-w-0 gap-0.5">
              <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                {item.name}
              </Text>
              <Text className="text-xs text-muted-foreground/70" numberOfLines={1}>
                {t(propertyTypeLabelKey(item.type))}
                {propertyOptions(item).length > 0
                  ? ` · ${propertyOptions(item).length} ${t("properties.value.optionCount")}`
                  : ""}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={14} color={muted} />
          </Pressable>
        )}
      />
    </View>
  );
}