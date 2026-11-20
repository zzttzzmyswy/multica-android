/**
 * Workspace switcher — presented as a formSheet by the parent Stack.
 *
 * Reached from the More popover's WorkspaceCard (collapsed single-row entry).
 * Lists every workspace the user belongs to, current one disabled with a
 * checkmark. A workspace OTHER than the current one that has unread inbox
 * items carries a brand dot in the same right-edge slot — web's sidebar
 * switcher does the same, so a pending notification in a workspace you are
 * not looking at is visible from here. Tapping a non-current row triggers an
 * iOS-native `Alert.alert` confirm — only after the user confirms do we
 * dismiss the sheet and `router.replace` to the target slug.
 *
 * Why a confirm step:
 *   The previous flow ("popover → tap row → instant switch") had no friction
 *   against fat-finger taps in the cramped popover, and the user lost their
 *   entire navigation context (tabs, scroll position) with one accidental
 *   tap. iOS Alert is the platform-correct gate (mobile/CLAUDE.md Principle
 *   3 — iOS native > RNR > discuss).
 *
 * Switching itself stays minimal: `router.dismiss()` to close this sheet,
 * then `router.replace(/${slug}/inbox)`. The downstream WorkspaceRouteLayout
 * handles `setCurrentWorkspace(slug, uuid)` on mount.
 */
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { Workspace } from "@multica/core/types";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Text } from "@/components/ui/text";
import { WorkspaceChoiceRow } from "@/components/workspace/workspace-choice-row";
import { inboxUnreadSummaryOptions } from "@/data/queries/inbox";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { workspaceUnreadBadge } from "@/lib/workspace-unread-badge";
import { useThemePalette } from "@/lib/appearance-a11y-runtime";

export default function SwitchWorkspaceRoute() {
  const activeSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const t = useThemePalette();
  const tr = useTranslation();
  const { data, isLoading, isError, refetch } = useQuery(workspaceListOptions());

  // Which OTHER workspaces have unread inbox items. Account-level query: one
  // cache entry shared with the More popover's WorkspaceCard, not refetched
  // per workspace. Gated on the active slug because the endpoint resolves
  // through the workspace-member middleware (same gate as web's sidebar).
  const activeId = (data ?? []).find((w) => w.slug === activeSlug)?.id ?? null;
  const { data: unreadSummary = [] } = useQuery({
    ...inboxUnreadSummaryOptions(),
    enabled: !!activeSlug,
  });
  const badge = workspaceUnreadBadge(unreadSummary, activeId);

  const onSelect = (ws: Workspace) => {
    if (ws.slug === activeSlug) return;
    Alert.alert(
      tr.t("switchWorkspace.title"),
      tr.t("switchWorkspace.message", { name: ws.name }),
      [
        { text: tr.t("common.cancel"), style: "cancel" },
        {
          text: tr.t("switchWorkspace.confirm"),
          onPress: () => {
            router.dismiss();
            router.replace(`/${ws.slug}/inbox`);
          },
        },
      ],
    );
  };

  return (
    <View className="flex-1 bg-background">
      <View className="flex-row items-center gap-3 border-b border-border/60 px-4 pb-3 pt-4">
        <View className="size-10 items-center justify-center rounded-xl bg-secondary">
          <Ionicons name="layers-outline" size={20} color={t.foreground} />
        </View>
        <Text accessibilityRole="header" className="min-w-0 flex-1 text-title font-semibold text-foreground">
          {tr.t("switchWorkspace.title")}
        </Text>
      </View>
      {isLoading ? (
        <View className="items-center py-8">
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="gap-3 px-4 py-4">
          {isError && !data ? (
            <View className="items-start gap-3 rounded-2xl border border-border bg-surface-1 p-3">
              <Text accessibilityLiveRegion="polite" className="text-body text-foreground">
                {tr.t("settings.workspacesLoadError")}
              </Text>
              <Button variant="outline" onPress={() => void refetch()} className="min-h-12 rounded-xl">
                <Text>{tr.t("common.retry")}</Text>
              </Button>
            </View>
          ) : data?.length ? (
            <View className="overflow-hidden rounded-2xl border border-border/70 bg-card">
              {data.map((ws, index) => (
                <View key={ws.id}>
                  {index > 0 ? <Separator /> : null}
                  <WorkspaceChoiceRow
                    workspace={ws}
                    active={ws.slug === activeSlug}
                    hasUnread={badge.unreadIds.has(ws.id)}
                    onPress={() => onSelect(ws)}
                  />
                </View>
              ))}
            </View>
          ) : null}
          {/* Keep onboarding on its existing route; the create action is not a workspace. */}
          <Pressable
            onPress={() =>
              router.push({
                pathname: "/onboarding",
                params: { mode: "new_workspace" },
              })
            }
            accessibilityRole="button"
            accessibilityLabel={tr.t("workspace.createNew")}
            className="min-h-12 flex-row items-center gap-2.5 rounded-xl border border-dashed border-border px-3 py-3 active:bg-secondary"
          >
            <Ionicons name="add-circle-outline" size={21} color={t.foreground} />
            <Text className="min-w-0 flex-1 text-body font-semibold text-foreground">
              {tr.t("workspace.createNew")}
            </Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}
