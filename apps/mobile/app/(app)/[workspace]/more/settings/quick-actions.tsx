/**
 * Workspace quick-actions management page (iteration-52) — mirrors web
 * `packages/views/settings/components/quick-actions-tab.tsx` on the phone.
 *
 * Each row shows the action name (+ archived badge), the bound target line
 * (display name, "private target" suffix, and a warning when the target is
 * unavailable or a public action points at a non-public target), a
 * visibility badge (Team / Just me), usage count (stale → warning tint after
 * 90 unused days, mirroring web's isStale), and the updated date.
 *
 * The overflow menu carries Edit / Archive|Restore / Delete (delete confirms
 * via Alert), matching web's row DropdownMenu. "New" (header action) pushes
 * the create form; tapping a row pushes the edit form. Non-managers get a
 * read-only list with no actions (web's canManage gate).
 */
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Switch,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { QuickAction } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { quickActionListOptions } from "@/data/queries/quick-actions";
import { useDeleteQuickAction, useUpdateQuickAction } from "@/data/mutations/quick-actions";
import { memberListOptions } from "@/data/queries/members";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { formatDateTime } from "@/lib/autopilot-format";
import { isStaleQuickAction } from "@/lib/quick-actions";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

function VisibilityBadge({ action }: { action: QuickAction }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  if (action.visibility === "public") {
    return (
      <View className="flex-row items-center gap-1 rounded-full bg-secondary px-2 py-0.5">
        <Ionicons name="globe-outline" size={10} color={theme.mutedForeground} />
        <Text className="text-[10px] font-medium text-muted-foreground">
          {t("quickActions.visibilityPublic")}
        </Text>
      </View>
    );
  }
  if (action.visibility === "private") {
    return (
      <View className="flex-row items-center gap-1 rounded-full border border-border px-2 py-0.5">
        <Ionicons name="lock-closed-outline" size={10} color={theme.mutedForeground} />
        <Text className="text-[10px] font-medium text-muted-foreground">
          {t("quickActions.visibilityPrivate")}
        </Text>
      </View>
    );
  }
  return (
    <View className="rounded-full border border-border px-2 py-0.5">
      <Text className="text-[10px] text-muted-foreground">{action.visibility}</Text>
    </View>
  );
}

function TargetLine({ action }: { action: QuickAction }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  if (action.target_missing === true) {
    return (
      <Text className="text-xs text-destructive">
        {t("quickActions.targetMissing")}
      </Text>
    );
  }
  const mismatched = action.visibility === "public" && action.target_public !== true;
  return (
    <Text
      className={cn(
        "text-xs",
        mismatched ? "text-warning" : "text-muted-foreground/80",
      )}
      numberOfLines={1}
    >
      {mismatched ? <Ionicons name="alert-circle-outline" size={11} color={theme.warning} /> : null}
      {action.target_name}
      {action.target_public !== true
        ? ` · ${t("quickActions.targetPrivate")}`
        : ""}
    </Text>
  );
}

export default function QuickActionsPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const user = useAuthStore((s) => s.user);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const currentMember = members.find((m) => m.user_id === user?.id) ?? null;
  const canManage =
    currentMember?.role === "owner" || currentMember?.role === "admin";

  const [showArchived, setShowArchived] = useState(false);
  const { data, isLoading, error, refetch, isRefetching } = useQuery(
    quickActionListOptions(wsId, showArchived),
  );

  const sorted = useMemo(() => {
    const list = data ?? [];
    return [...list].sort((a, b) => {
      if (a.status !== b.status) return a.status === "active" ? -1 : 1;
      if (b.use_count !== a.use_count) return b.use_count - a.use_count;
      return a.name.localeCompare(b.name);
    });
  }, [data]);

  const showEmpty = !isLoading && !error && sorted.length === 0;

  const headerRight = useCallback(() => {
    if (!canManage || !wsSlug) return null;
    return (
      <IconButton
        name="add"
        onPress={() => router.push(`/${wsSlug}/more/settings/quick-actions/new`)}
        accessibilityLabel={t("quickActions.add")}
      />
    );
  }, [canManage, wsSlug, t]);

  const updateAction = useUpdateQuickAction();
  const deleteAction = useDeleteQuickAction();

  const handleArchiveToggle = (action: QuickAction) => {
    const next = action.status === "active" ? "archived" : "active";
    updateAction.mutate({ id: action.id, status: next });
  };

  const confirmDelete = (action: QuickAction) => {
    Alert.alert(
      t("quickActions.deleteTitle"),
      t("quickActions.deleteDescription"),
      [
        { text: t("quickActions.cancel"), style: "cancel" },
        {
          text: t("quickActions.delete"),
          style: "destructive",
          onPress: () => deleteAction.mutate(action.id),
        },
      ],
    );
  };

  return (
    <>
      <Stack.Screen
        options={{ title: t("screen.quickActions"), headerRight }}
      />
      <View className="flex-1 bg-background">
        <View className="flex-row items-center justify-between border-b border-border px-4 py-2.5">
          <View className="flex-row items-center gap-2">
            <Switch
              value={showArchived}
              onValueChange={setShowArchived}
              trackColor={{ false: theme.border, true: theme.primary }}
              thumbColor={theme.background}
            />
            <Text className="text-xs text-muted-foreground">
              {t("quickActions.archived")}
            </Text>
          </View>
        </View>

        {!canManage ? (
          <View className="border-b border-border px-4 py-2">
            <Text className="text-xs text-muted-foreground">
              {t("quickActions.manageHint")}
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
              {t("quickActions.loading")}
              {error instanceof Error ? error.message : t("common.unknownError")}
            </Text>
            <Button variant="outline" onPress={() => refetch()}>
              <Text>{t("workspace.retry")}</Text>
            </Button>
          </View>
        ) : showEmpty ? (
          <View className="flex-1 items-center justify-center px-6 gap-1">
            <Ionicons name="flash-outline" size={32} color={theme.mutedForeground} />
            <Text className="text-sm text-muted-foreground text-center mt-2">
              {showArchived
                ? t("quickActions.noResults")
                : t("quickActions.emptyTitle")}
            </Text>
            {!showArchived ? (
              <Text className="text-xs text-muted-foreground/70 text-center">
                {t("quickActions.emptyHint")}
              </Text>
            ) : null}
            {canManage && wsSlug ? (
              <Button
                variant="outline"
                className="mt-3"
                onPress={() =>
                  router.push(`/${wsSlug}/more/settings/quick-actions/new`)
                }
              >
                <Ionicons name="add" size={15} color={theme.mutedForeground} />
                <Text>{t("quickActions.add")}</Text>
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
              <QuickActionRow
                action={item}
                canManage={canManage}
                onEdit={() =>
                  wsSlug &&
                  router.push(`/${wsSlug}/more/settings/quick-actions/${item.id}`)
                }
                onArchiveToggle={() => handleArchiveToggle(item)}
                onDelete={() => confirmDelete(item)}
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

function QuickActionRow({
  action,
  canManage,
  onEdit,
  onArchiveToggle,
  onDelete,
}: {
  action: QuickAction;
  canManage: boolean;
  onEdit: () => void;
  onArchiveToggle: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const muted = theme.mutedForeground;
  const stale = isStaleQuickAction(action);
  const archived = action.status !== "active";

  return (
    <Pressable onPress={onEdit} disabled={!canManage} className="px-4 py-3 active:bg-secondary">
      <View className="flex-row items-center gap-3">
        <View className="size-8 rounded-md bg-secondary items-center justify-center">
          <Ionicons name="flash" size={15} color={muted} />
        </View>
        <View className="flex-1 min-w-0 gap-0.5">
          <View className="flex-row items-center gap-2">
            <Text
              className={cn(
                "text-sm font-medium text-foreground",
                archived && "text-muted-foreground",
              )}
              numberOfLines={1}
            >
              {action.name}
            </Text>
            {archived ? (
              <View className="rounded-full bg-secondary px-1.5 py-0.5">
                <Text className="text-[10px] text-muted-foreground font-medium">
                  {t("quickActions.archived")}
                </Text>
              </View>
            ) : null}
          </View>
          <TargetLine action={action} />
        </View>
        <View className="items-end gap-1">
          <VisibilityBadge action={action} />
          <Text
            className={cn(
              "text-[10px] tabular-nums",
              stale ? "text-warning" : "text-muted-foreground/70",
            )}
          >
            {action.use_count === 0
              ? t("quickActions.neverUsed")
              : t("quickActions.usedCount", { count: action.use_count })}
          </Text>
          <Text className="text-[10px] text-muted-foreground/50">
            {formatDateTime(action.updated_at)}
          </Text>
        </View>
        {canManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Pressable hitSlop={8} className="p-1" accessibilityLabel={action.name}>
                <Ionicons name="ellipsis-horizontal" size={16} color={muted} />
              </Pressable>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onPress={onEdit}>
                <Ionicons name="create-outline" size={15} color={muted} />
                <Text>{t("quickActions.edit")}</Text>
              </DropdownMenuItem>
              <DropdownMenuItem onPress={onArchiveToggle}>
                <Ionicons
                  name={archived ? "archive-outline" : "archive-outline"}
                  size={15}
                  color={muted}
                />
                <Text>{archived ? t("quickActions.unarchive") : t("quickActions.archive")}</Text>
              </DropdownMenuItem>
              <DropdownMenuItem onPress={onDelete} className="text-destructive">
                <Ionicons name="trash-outline" size={15} color={theme.destructive} />
                <Text className="text-destructive">{t("quickActions.delete")}</Text>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Ionicons name="lock-closed-outline" size={13} color={muted} />
        )}
      </View>
    </Pressable>
  );
}