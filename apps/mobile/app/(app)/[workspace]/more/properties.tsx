/**
 * Workspace custom-property management page (MYS-668). Aligns web
 * `packages/views/settings/components/properties-tab.tsx` as a push screen
 * reached from the More popover and Settings — owner/admin surface, so the
 * create entry is gated and a read-only hint shows for everyone else (web
 * `editor.admin_hint`). Each row renders name (with archived badge), type,
 * option chips (6 + overflow), usage count and updated date; tapping a row
 * pushes the edit form where rename / re-option / archive / restore live
 * (`PropertyForm`). Search + "Show archived" mirror web's table filters.
 */
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  TextInput,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { IssueProperty } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Switch } from "@/components/ui/switch";
import { propertyCatalogOptions } from "@/data/queries/properties";
import { memberListOptions } from "@/data/queries/members";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useAuthStore } from "@/data/auth-store";
import {
  filterPropertyCatalog,
  MAX_ACTIVE_PROPERTIES,
  propertyHasOptions,
  propertyOptionChips,
} from "@/lib/property-catalog";
import { propertyTypeIcon, propertyTypeLabelKey } from "@/lib/issue-properties";
import { propertyIconGlyph } from "@/lib/property-icons";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

export default function PropertiesPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const user = useAuthStore((s) => s.user);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;

  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const { data, isLoading, error, refetch, isRefetching } = useQuery(
    propertyCatalogOptions(wsId),
  );
  const members = useQuery(memberListOptions(wsId));
  const currentMember = members.data?.find((m) => m.user_id === user?.id);
  const canManage =
    currentMember?.role === "owner" || currentMember?.role === "admin";

  const { visible, activeCount } = useMemo(
    () =>
      filterPropertyCatalog(data ?? [], {
        query,
        showArchived,
      }),
    [data, query, showArchived],
  );

  const headerRight = useCallback(() => {
    if (!wsSlug || !canManage) return null;
    return (
      <IconButton
        name="add"
        disabled={activeCount >= MAX_ACTIVE_PROPERTIES}
        onPress={() => router.push(`/${wsSlug}/more/properties/new`)}
        accessibilityLabel={t("properties.newProperty")}
      />
    );
  }, [wsSlug, canManage, activeCount, t]);

  const showEmpty = !isLoading && !error && visible.length === 0;
  const querying =
    showEmpty && query.trim().length > 0;

  return (
    <>
      <Stack.Screen
        options={{
          title: t("screen.properties"),
          headerRight,
        }}
      />
      <View className="flex-1 bg-background">
        <PropertiesToolbar
          query={query}
          onQueryChange={setQuery}
          showArchived={showArchived}
          onShowArchivedChange={setShowArchived}
          activeCount={activeCount}
          canManage={canManage}
        />
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
            <Ionicons name="options-outline" size={32} color={muted} />
            {querying ? (
              <Text className="text-sm text-muted-foreground text-center mt-2">
                {t("properties.noResults")}
              </Text>
            ) : (
              <>
                <Text className="text-sm text-muted-foreground text-center mt-2">
                  {t("properties.emptyTitle")}
                </Text>
                <Text className="text-xs text-muted-foreground/70 text-center">
                  {t("properties.emptyDescription")}
                </Text>
                {canManage ? (
                  <Button
                    variant="outline"
                    className="mt-3"
                    onPress={() =>
                      wsSlug && router.push(`/${wsSlug}/more/properties/new`)
                    }
                  >
                    <Ionicons name="add" size={15} color={muted} />
                    <Text>{t("properties.newProperty")}</Text>
                  </Button>
                ) : null}
              </>
            )}
          </View>
        ) : (
          <FlatList
            data={visible}
            keyExtractor={(item) => item.id}
            ItemSeparatorComponent={() => <View className="h-px bg-border ml-4" />}
            contentContainerClassName="pb-6"
            renderItem={({ item }) => (
              <PropertyRow
                property={item}
                onPress={() => {
                  if (wsSlug)
                    router.push(`/${wsSlug}/more/properties/${item.id}`);
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

function PropertiesToolbar({
  query,
  onQueryChange,
  showArchived,
  onShowArchivedChange,
  activeCount,
  canManage,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  showArchived: boolean;
  onShowArchivedChange: (value: boolean) => void;
  activeCount: number;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;

  return (
    <View className="px-4 pt-3 pb-2 gap-3">
      <View className="flex-row items-center gap-2 rounded-lg border border-border px-3 bg-background">
        <Ionicons name="search" size={16} color={muted} />
        <TextInput
          value={query}
          onChangeText={onQueryChange}
          placeholder={t("properties.searchPlaceholder")}
          placeholderTextColor={muted}
          className="flex-1 py-2.5 text-sm text-foreground"
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <Switch
            checked={showArchived}
            onCheckedChange={onShowArchivedChange}
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
        <Text className="text-xs text-muted-foreground/80">
          {t("properties.adminHint")}
        </Text>
      ) : null}
    </View>
  );
}

function PropertyRow({
  property,
  onPress,
}: {
  property: IssueProperty;
  onPress: () => void;
}) {
  const { colorScheme } = useColorScheme();
  const { t } = useTranslation();
  const muted = THEME[colorScheme].mutedForeground;
  const usage = property.usage_count ?? 0;
  const { chips, rest } = propertyOptionChips(property);
  const hasOptions = propertyHasOptions(property);
  // Row head: prefer the server-persisted icon; fall back to the type icon
  // when the property has none (web renders null there; a type glyph is the
  // mobile fallback so the head is never blank).
  const rowGlyph = property.icon
    ? propertyIconGlyph(property.icon)
    : propertyTypeIcon(property.type);

  return (
    <Pressable onPress={onPress} className="px-4 py-3 active:bg-secondary">
      <View className="flex-row items-center gap-3">
        <View className="size-9 rounded-lg bg-secondary items-center justify-center">
          <Ionicons
            name={rowGlyph}
            size={18}
            color={muted}
          />
        </View>
        <View className="flex-1 min-w-0 gap-1">
          <View className="flex-row items-center gap-1.5">
            <Text
              className="text-sm font-medium text-foreground"
              numberOfLines={1}
            >
              {property.name}
            </Text>
            {property.archived ? (
              <View className="px-1.5 py-0.5 rounded border border-border">
                <Text className="text-[10px] text-muted-foreground">
                  {t("properties.archivedBadge")}
                </Text>
              </View>
            ) : null}
          </View>
          <View className="flex-row items-center gap-1.5 flex-wrap">
            <Text className="text-xs text-muted-foreground">
              {t(propertyTypeLabelKey(property.type))}
            </Text>
            {hasOptions && chips.length > 0 ? (
              <>
                {chips.map((option) => (
                  <View
                    key={option.id ?? option.name}
                    className="flex-row items-center gap-1 rounded-full border border-border px-1.5 py-0.5"
                  >
                    <View
                      className="size-2 rounded-full"
                      style={{ backgroundColor: option.color }}
                    />
                    <Text className="text-[11px] text-foreground">
                      {option.name}
                    </Text>
                  </View>
                ))}
                {rest > 0 ? (
                  <Text className="text-[11px] text-muted-foreground">
                    +{rest}
                  </Text>
                ) : null}
              </>
            ) : (
              <Text className="text-xs text-muted-foreground/50">—</Text>
            )}
          </View>
        </View>
        <View className="items-end gap-1">
          <View className="px-2 py-0.5 rounded-full bg-secondary">
            <Text className="text-[11px] text-muted-foreground font-medium tabular-nums">
              {t("properties.usageCount", { count: usage })}
            </Text>
          </View>
          <Text className="text-[10px] text-muted-foreground/60">
            {new Date(property.updated_at).toLocaleDateString()}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={14} color={muted} />
      </View>
    </Pressable>
  );
}