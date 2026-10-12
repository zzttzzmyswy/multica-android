/**
 * Workspace custom-property management page (MYS-668). Aligns web
 * `packages/views/settings/components/properties-tab.tsx` as a push screen
 * reached from the More popover and Settings — owner/admin surface, so the
 * create entry is gated and a read-only hint shows for everyone else (web
 * `editor.admin_hint`). Each row renders name (with archived badge), type,
 * option chips (6 + overflow), usage count and updated date; tapping a row
 * pushes the edit form where rename / re-option / archive / restore live
 * (`PropertyForm`). Search + "Show archived" mirror web's table filters.
 *
 * Row actions (iteration 231, MYS-2102): each row gained the kebab web's row
 * menu renders — edit / archive, with archive flipping to restore on an
 * archived row. The items and the owner/admin gate live in
 * `lib/property-row-actions.ts`; the write lives here so the kebab and the edit
 * form share `useUpdateProperty`, and so both word the archive confirm
 * identically.
 */
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { HeaderSearchGroup } from "@/components/ui/header-search-button";
import { Switch } from "@/components/ui/switch";
import { PropertyRowMenu } from "@/components/property/property-row-menu";
import { propertyCatalogOptions } from "@/data/queries/properties";
import { useUpdateProperty } from "@/data/mutations/properties";
import { memberListOptions } from "@/data/queries/members";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useAuthStore } from "@/data/auth-store";
import {
  canManageProperties,
} from "@/lib/property-row-actions";
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
  // Web's `canManage` (`properties-tab.tsx:123`) — kept in the shared helper so
  // the screen and the row menu read one rule instead of two copies of
  // `role === "owner" || role === "admin"`.
  const canManage = canManageProperties(currentMember?.role);

  // ── Row actions (iteration 231, MYS-2102) ────────────────────────────────
  // The archive/restore write lives HERE for the same reason the delete on the
  // labels list does: the edit form toggles through this same mutation, so the
  // kebab and the form cannot drift on what archiving does.
  const updateProperty = useUpdateProperty();

  const openEdit = useCallback(
    (property: IssueProperty) => {
      if (wsSlug) router.push(`/${wsSlug}/more/properties/${property.id}`);
    },
    [wsSlug],
  );

  /**
   * The archive confirm, worded exactly as the edit form's own toggle — the
   * same `properties.archiveTitle` / `properties.archiveMessage` keys. Web
   * routes archive through `pendingArchive` for exactly this reason; restore
   * below does not, matching web's asymmetry (restore is recoverable in one
   * more tap, archive is what the dialog exists to make deliberate).
   */
  const handleArchive = useCallback(
    (row: IssueProperty) => {
      if (updateProperty.isPending) return;
      Alert.alert(
        t("properties.archiveTitle"),
        t("properties.archiveMessage", { name: row.name }),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("properties.archive"),
            style: "destructive",
            onPress: () =>
              updateProperty.mutate(
                { id: row.id, archived: true },
                {
                  onError: (err) =>
                    Alert.alert(
                      t("properties.saveFailed"),
                      err instanceof Error
                        ? err.message
                        : t("common.unknownError"),
                    ),
                },
              ),
          },
        ],
      );
    },
    [updateProperty, t],
  );

  /**
   * Restore writes straight through, as web does. The edit form confirms it,
   * which is a deliberate difference from this side: on the form the toggle
   * sits among other fields and a stray tap costs more, whereas here the user
   * picked "Restore" out of a menu they opened on that exact row.
   */
  const handleRestore = useCallback(
    (row: IssueProperty) => {
      if (updateProperty.isPending) return;
      updateProperty.mutate(
        { id: row.id, archived: false },
        {
          onError: (err) =>
            Alert.alert(
              t("properties.saveFailed"),
              err instanceof Error ? err.message : t("common.unknownError"),
            ),
        },
      );
    },
    [updateProperty, t],
  );

  const { visible, activeCount } = useMemo(
    () =>
      filterPropertyCatalog(data ?? [], {
        query,
        showArchived,
      }),
    [data, query, showArchived],
  );

  const headerRight = useCallback(() => {
    // Same split as squads / mcp-servers: the "+" needs canManage, search
    // never does.
    if (!wsSlug || !canManage) return <HeaderSearchGroup />;
    return (
      <HeaderSearchGroup>
        <IconButton
          name="add"
          disabled={activeCount >= MAX_ACTIVE_PROPERTIES}
          onPress={() => router.push(`/${wsSlug}/more/properties/new`)}
          accessibilityLabel={t("properties.newProperty")}
        />
      </HeaderSearchGroup>
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
            <Text className="text-body text-destructive">
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
              <Text className="text-body text-muted-foreground text-center mt-2">
                {t("properties.noResults")}
              </Text>
            ) : (
              <>
                <Text className="text-body text-muted-foreground text-center mt-2">
                  {t("properties.emptyTitle")}
                </Text>
                <Text className="text-caption text-muted-foreground/70 text-center">
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
                canManage={canManage}
                onPress={() => openEdit(item)}
                onEdit={() => openEdit(item)}
                onArchive={() => handleArchive(item)}
                onRestore={() => handleRestore(item)}
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
          className="flex-1 py-2.5 text-body text-foreground"
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
          <Text className="text-caption text-muted-foreground">
            {t("properties.showArchived")}
          </Text>
        </View>
        <Text className="text-caption tabular-nums text-muted-foreground">
          {t("properties.limitHint", {
            count: activeCount,
            max: MAX_ACTIVE_PROPERTIES,
          })}
        </Text>
      </View>
      {!canManage ? (
        <Text className="text-caption text-muted-foreground/80">
          {t("properties.adminHint")}
        </Text>
      ) : null}
    </View>
  );
}

function PropertyRow({
  property,
  canManage,
  onPress,
  onEdit,
  onArchive,
  onRestore,
}: {
  property: IssueProperty;
  /** Web's `canManage` — the kebab renders only for owner/admin, with no
   *  disabled placeholder (`properties-tab.tsx:260,313`). */
  canManage: boolean;
  onPress: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
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
              className="text-body font-medium text-foreground"
              numberOfLines={1}
            >
              {property.name}
            </Text>
            {property.archived ? (
              <View className="px-1.5 py-0.5 rounded border border-border">
                <Text className="text-micro text-muted-foreground">
                  {t("properties.archivedBadge")}
                </Text>
              </View>
            ) : null}
          </View>
          <View className="flex-row items-center gap-1.5 flex-wrap">
            <Text className="text-caption text-muted-foreground">
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
                    <Text className="text-micro text-foreground">
                      {option.name}
                    </Text>
                  </View>
                ))}
                {rest > 0 ? (
                  <Text className="text-micro text-muted-foreground">
                    +{rest}
                  </Text>
                ) : null}
              </>
            ) : (
              <Text className="text-caption text-muted-foreground/50">—</Text>
            )}
          </View>
        </View>
        <View className="items-end gap-1">
          <View className="px-2 py-0.5 rounded-full bg-secondary">
            <Text className="text-micro text-muted-foreground font-medium tabular-nums">
              {t("properties.usageCount", { count: usage })}
            </Text>
          </View>
          <Text className="text-micro text-muted-foreground/60">
            {new Date(property.updated_at).toLocaleDateString()}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={14} color={muted} />
        {/* Row actions (MYS-2102). Owner/admin only — web renders an empty
            `<span />` for everyone else rather than a disabled trigger, and the
            toolbar above already carries the matching `adminHint`. */}
        <PropertyRowMenu
          property={property}
          canManage={canManage}
          onEdit={onEdit}
          onArchive={onArchive}
          onRestore={onRestore}
        />
      </View>
    </Pressable>
  );
}