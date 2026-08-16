/**
 * Workspace custom-property management page (MYS-334). Pushed from the More
 * popover (owner/admin only entry). Mirrors web's
 * `packages/views/settings/components/properties-tab.tsx`:
 *
 *   - List of property definitions (name / type / option chips / usage /
 *     archived badge), including a "show archived" toggle.
 *   - "+" header action opens the create form (more/properties/new); tapping
 *     a row opens the edit form (more/properties/[id]) where rename, option
 *     editing and archive/restore live.
 *   - Owner/admin gate: non-owners get a read-only list with no row edit /
 *     create affordances (per web's canManage semantics).
 */
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Switch, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import type { IssueProperty } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { propertyCatalogOptions } from "@/data/queries/properties";
import { memberListOptions } from "@/data/queries/members";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  isKnownPropertyType,
  propertyOptions,
  propertyTypeHasOptions,
  propertyTypeIcon,
  propertyTypeLabelKey,
} from "@/lib/issue-properties";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

// Same cap as web's MAX_ACTIVE_PROPERTIES.
const MAX_ACTIVE_PROPERTIES = 20;

export default function PropertiesPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const user = useAuthStore((s) => s.user);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  const { data: catalogs, isLoading, error, refetch, isRefetching } = useQuery(
    propertyCatalogOptions(wsId),
  );
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const currentMember = members.find((m) => m.user_id === user?.id) ?? null;
  const canManage =
    currentMember?.role === "owner" || currentMember?.role === "admin";

  const [showArchived, setShowArchived] = useState(false);

  const activeCount = useMemo(
    () => (catalogs ?? []).filter((p) => !p.archived).length,
    [catalogs],
  );
  const visible = useMemo(
    () =>
      (catalogs ?? []).filter((p) => (showArchived ? true : !p.archived)),
    [catalogs, showArchived],
  );
  const sorted = useMemo(
    () =>
      [...visible].sort((a, b) => {
        if (a.archived !== b.archived) return a.archived ? 1 : -1;
        return a.name.localeCompare(b.name);
      }),
    [visible],
  );

  const showEmpty = !isLoading && !error && sorted.length === 0;

  const headerRight = useCallback(() => {
    if (!canManage || !wsSlug) return null;
    return (
      <IconButton
        name="add"
        onPress={() => router.push(`/${wsSlug}/more/properties/new`)}
        accessibilityLabel={t("properties.newProperty")}
      />
    );
  }, [canManage, wsSlug, t]);

  return (
    <>
      <Stack.Screen options={{ title: t("screen.properties"), headerRight }} />
      <View className="flex-1 bg-background">
        {/* Toolbar: show-archived toggle + active count */}
        <View className="flex-row items-center justify-between border-b border-border px-4 py-2.5">
          <View className="flex-row items-center gap-2">
            <Switch
              value={showArchived}
              onValueChange={setShowArchived}
              trackColor={{ false: theme.border, true: theme.primary }}
              thumbColor={theme.background}
            />
            <Text className="text-xs text-muted-foreground">
              {t("properties.showArchived")}
            </Text>
          </View>
          <Text className="text-xs tabular-nums text-muted-foreground">
            {t("properties.limitHint", {
              count: activeCount,
              max: MAX_ACTIVE_PROPERTIES,
            })}
          </Text>
        </View>

        {!canManage ? (
          <View className="border-b border-border px-4 py-2">
            <Text className="text-xs text-muted-foreground">
              {t("properties.adminHint")}
            </Text>
          </View>
        ) : null}

        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator />
          </View>
        ) : error ? (
          <View className="px-4 gap-3 pt-4">
            <Text className="text-sm text-destructive">
              {t("properties.loadError")}
              {error instanceof Error ? error.message : t("common.unknownError")}
            </Text>
            <Button variant="outline" onPress={() => refetch()}>
              <Text>{t("workspace.retry")}</Text>
            </Button>
          </View>
        ) : showEmpty ? (
          <View className="flex-1 items-center justify-center px-6 gap-1">
            <Ionicons
              name="options-outline"
              size={32}
              color={theme.mutedForeground}
            />
            <Text className="text-sm text-muted-foreground text-center mt-2">
              {t(showArchived ? "properties.emptyArchivedTitle" : "properties.emptyTitle")}
            </Text>
            <Text className="text-xs text-muted-foreground/70 text-center">
              {t("properties.emptyDescription")}
            </Text>
            {canManage && wsSlug ? (
              <Button
                variant="outline"
                className="mt-3"
                onPress={() => router.push(`/${wsSlug}/more/properties/new`)}
              >
                <Ionicons name="add" size={15} color={theme.mutedForeground} />
                <Text>{t("properties.newProperty")}</Text>
              </Button>
            ) : null}
          </View>
        ) : (
          <FlatList
            data={sorted}
            keyExtractor={(item) => item.id}
            ItemSeparatorComponent={() => <View className="h-px bg-border ml-4" />}
            contentContainerClassName="pb-6"
            renderItem={({ item }) => (
              <PropertyRow
                property={item}
                canManage={canManage}
                onPress={() => {
                  if (wsSlug && canManage) {
                    router.push(`/${wsSlug}/more/properties/${item.id}`);
                  }
                }}
              />
            )}
            refreshing={isRefetching}
            onRefresh={refetch}
          />
        )}
      </View>
    </>
  );
}

function PropertyRow({
  property,
  canManage,
  onPress,
}: {
  property: IssueProperty;
  canManage: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const usage = property.usage_count ?? 0;
  const options = propertyOptions(property);
  const hasOptions = propertyTypeHasOptions(property.type);

  return (
    <Pressable onPress={onPress} disabled={!canManage} className="px-4 py-3 active:bg-secondary">
      <View className="flex-row items-center gap-3">
        <View className="size-8 rounded-md bg-secondary items-center justify-center">
          <Ionicons
            name={propertyTypeIcon(property.type)}
            size={16}
            color={muted}
          />
        </View>
        <View className="flex-1 min-w-0 gap-0.5">
          <View className="flex-row items-center gap-2">
            <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
              {property.name}
            </Text>
            {property.archived ? (
              <View className="rounded-full bg-secondary px-1.5 py-0.5">
                <Text className="text-[10px] text-muted-foreground font-medium">
                  {t("properties.archivedBadge")}
                </Text>
              </View>
            ) : null}
          </View>
          <Text className="text-xs text-muted-foreground/70" numberOfLines={1}>
            {t(propertyTypeLabelKey(property.type))}
            {isKnownPropertyType(property.type) ? "" : property.type}
          </Text>
          {hasOptions && options.length > 0 ? (
            <View className="flex-row flex-wrap items-center gap-1 pt-1">
              {options.slice(0, 4).map((option) => (
                <View
                  key={option.id}
                  className="flex-row items-center gap-1 rounded-full border border-border px-1.5 py-px"
                >
                  <View
                    className="size-2 rounded-full"
                    style={{ backgroundColor: option.color }}
                  />
                  <Text className="text-[10px] text-foreground/80" numberOfLines={1}>
                    {option.name}
                  </Text>
                </View>
              ))}
              {options.length > 4 ? (
                <Text className="text-[10px] text-muted-foreground">
                  +{options.length - 4}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
        {usage > 0 ? (
          <View className="px-2 py-0.5 rounded-full bg-secondary">
            <Text className="text-[11px] text-muted-foreground font-medium tabular-nums">
              {usage}
            </Text>
          </View>
        ) : null}
        <Ionicons
          name={canManage ? "chevron-forward" : "lock-closed-outline"}
          size={14}
          color={muted}
        />
      </View>
    </Pressable>
  );
}