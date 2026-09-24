/**
 * Workspace labels browse page (push screen reached from the More popover).
 * Management-only surface: there is no label detail page (web has none
 * either) — each row shows the color swatch, name, description and usage
 * count, and tapping it pushes the edit form where rename/recolor/delete
 * live. Mirrors `packages/views/settings/components/labels-tab.tsx` read
 * semantics, card-listed for the phone like the squads page.
 *
 * Two catalogs, matching web's `RESOURCE_TYPES`: the scope control switches
 * between issue labels (the legacy unscoped list, shared with the issue
 * pickers) and the separate skill catalog. The search box filters the active
 * catalog by name or description; switching scope clears it, as web does.
 *
 * Pull-to-refresh + friendly empty/loading/error states, matching the
 * squads/members pages. The "+" header action opens the create form bound to
 * the scope on screen.
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
import type { Label } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { labelScopeOptions } from "@/data/queries/labels";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import {
  filterLabels,
  LABEL_SCOPES,
  type LabelScope,
} from "@/lib/labels-display";

export default function LabelsPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;

  const [scope, setScope] = useState<LabelScope>("issue");
  const [query, setQuery] = useState("");

  const { data, isLoading, error, refetch, isRefetching } = useQuery(
    labelScopeOptions(wsId, scope),
  );

  const visible = useMemo(
    () =>
      filterLabels(data ?? [], scope, query).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [data, scope, query],
  );

  const scopeLabel = t(`labels.scope.${scope}`);
  const searching = query.trim().length > 0;
  const showEmpty = !isLoading && !error && visible.length === 0;

  const changeScope = useCallback((next: LabelScope) => {
    setScope(next);
    // Web clears the query on scope change — a term that matched in one
    // catalog usually means nothing in the other.
    setQuery("");
  }, []);

  const headerRight = useCallback(() => {
    if (!wsSlug) return null;
    return (
      <IconButton
        name="add"
        onPress={() => router.push(`/${wsSlug}/more/labels/new?scope=${scope}`)}
        accessibilityLabel={t("labels.new.title")}
      />
    );
  }, [wsSlug, scope, t]);

  return (
    <>
      <Stack.Screen options={{ headerRight }} />
      <View className="flex-1 bg-background">
        <View className="px-4 pt-3 pb-2 gap-3">
          <SegmentedControl
            options={LABEL_SCOPES.map((value) => ({
              value,
              label: t(`labels.scope.${value}`),
            }))}
            value={scope}
            onChange={changeScope}
          />
          <View className="flex-row items-center gap-2 rounded-lg border border-border px-3 bg-background">
            <Ionicons name="search" size={16} color={muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t("labels.searchPlaceholder")}
              placeholderTextColor={muted}
              className="flex-1 py-2.5 text-sm text-foreground"
              autoCorrect={false}
              autoCapitalize="none"
            />
            {searching ? (
              <Pressable
                onPress={() => setQuery("")}
                accessibilityLabel={t("common.clear")}
                hitSlop={8}
              >
                <Ionicons name="close-circle" size={16} color={muted} />
              </Pressable>
            ) : null}
          </View>
        </View>

        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator />
          </View>
        ) : error ? (
          <View className="px-4 gap-3 pt-4">
            <Text className="text-sm text-destructive">
              {t("labels.loadError")}
              {error instanceof Error ? error.message : t("common.unknownError")}
            </Text>
            <Button variant="outline" onPress={() => refetch()}>
              <Text>{t("workspace.retry")}</Text>
            </Button>
          </View>
        ) : showEmpty ? (
          <View className="flex-1 items-center justify-center px-6 gap-1">
            <Ionicons name="pricetags-outline" size={32} color={muted} />
            <Text className="text-sm text-muted-foreground text-center mt-2">
              {searching
                ? t("labels.noResults")
                : t("labels.emptyScope", { scope: scopeLabel })}
            </Text>
            {!searching ? (
              <Text className="text-xs text-muted-foreground/70 text-center">
                {t("labels.emptyDescription")}
              </Text>
            ) : null}
            {!searching && wsSlug ? (
              <Button
                variant="outline"
                className="mt-3"
                onPress={() =>
                  router.push(`/${wsSlug}/more/labels/new?scope=${scope}`)
                }
              >
                <Ionicons name="add" size={15} color={muted} />
                <Text>{t("labels.createButton")}</Text>
              </Button>
            ) : null}
          </View>
        ) : (
          <FlatList
            data={visible}
            keyExtractor={(item) => item.id}
            ItemSeparatorComponent={() => <View className="h-px bg-border ml-4" />}
            contentContainerClassName="pb-6"
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <LabelRow
                label={item}
                onPress={() => {
                  if (wsSlug) router.push(`/${wsSlug}/more/labels/${item.id}`);
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

function LabelRow({
  label,
  onPress,
}: {
  label: Label;
  onPress: () => void;
}) {
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const usage = label.usage_count ?? 0;

  return (
    <Pressable onPress={onPress} className="px-4 py-3 active:bg-secondary">
      <View className="flex-row items-center gap-3">
        <View
          className="size-4 rounded-[4px]"
          style={{ backgroundColor: label.color }}
        />
        <View className="flex-1 min-w-0 gap-0.5">
          <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
            {label.name}
          </Text>
          {label.description ? (
            <Text
              className="text-xs text-muted-foreground/70"
              numberOfLines={1}
            >
              {label.description}
            </Text>
          ) : null}
        </View>
        {usage > 0 ? (
          <View className="px-2 py-0.5 rounded-full bg-secondary">
            <Text className="text-[11px] text-muted-foreground font-medium">
              {usage}
            </Text>
          </View>
        ) : null}
        <Ionicons name="chevron-forward" size={14} color={muted} />
      </View>
    </Pressable>
  );
}
