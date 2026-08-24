/**
 * Member detail screen. Reached from the members list row (keyed by the
 * workspace-membership id, unique within the workspace). Mirrors web's
 * member-detail read surface: header avatar + name + role badge + email,
 * then a profile section (role, joined, user id) and — when the current
 * user may manage this member — a Manage section.
 *
 * Management guards mirror web's members-tab (packages/views/settings/
 * components/members-tab.tsx:100-103):
 *   - canEditRole / canRemove = canManage && !isSelf && role !== "owner"
 *     (mobile deliberately only supports admin ↔ member changes — owner
 *     promotion/demotion stays a web/web-console action)
 *   - the server remains the authoritative permission gate: PATCH/DELETE
 *     reject unauthorized calls regardless of what the UI shows.
 *
 * No optimistic patching (iteration-24 lesson: patch with the authoritative
 * response object, don't hand-roll it) — both mutations settle with a
 * members-list invalidate, so badge changes and removals re-read truth.
 * Remove navigates back on success.
 */
import { useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { MemberRole } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { ActorIssuesPanel } from "@/components/issue/actor-issues-panel";
import { memberListOptions } from "@/data/queries/members";
import { issueKeys } from "@/data/queries/issue-keys";
import { useUpdateMemberRole, useRemoveMember } from "@/data/mutations/members";
import { useAuthStore } from "@/data/auth-store";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { formatDateTime } from "@/lib/autopilot-format";
import { ActionSheet } from "@/lib/action-sheet";
import { memberManageGuards } from "@/lib/member-guards";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

const ROLE_BADGE: Record<MemberRole, string> = {
  owner: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  admin: "bg-brand/10 text-brand",
  member: "bg-muted text-muted-foreground",
};

export default function MemberDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const user = useAuthStore((s) => s.user);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const queryClient = useQueryClient();

  const { data: members, isLoading, refetch, isRefetching } = useQuery(
    memberListOptions(wsId),
  );
  const workspaces = useQuery(workspaceListOptions());
  const updateRole = useUpdateMemberRole();
  const removeMember = useRemoveMember();

  const workspace = workspaces.data?.find((w) => w.id === wsId);
  const member = members?.find((m) => m.id === id) ?? null;
  const currentMember =
    members?.find((m) => m.user_id === user?.id) ?? null;

  // === Management guards (web members-tab parity) ===
  // Extracted pure function (lib/member-guards.ts) so the self-protection
  // / owner-protection rules are unit-tested — see member-guards.test.ts.
  const { canEditRole, canRemove } = memberManageGuards({
    currentRole: currentMember?.role,
    currentUserId: user?.id,
    target: member,
  });

  const onChangeRolePress = useCallback(() => {
    if (!member) return;
    ActionSheet.showActionSheetWithOptions(
      {
        title: t("members.detail.changeRole"),
        options: [
          t("members.role.admin"),
          t("members.role.member"),
          t("common.cancel"),
        ],
        cancelButtonIndex: 2,
      },
      (index) => {
        const nextRole = index === 0 ? "admin" : index === 1 ? "member" : null;
        if (nextRole == null || nextRole === member.role || !wsId) return;
        updateRole.mutate(
          { memberId: member.id, role: nextRole },
          {
            onSuccess: () => Alert.alert(t("members.detail.roleUpdated")),
            onError: (err) =>
              Alert.alert(
                t("members.detail.roleUpdateFailed"),
                err instanceof Error ? err.message : t("common.unknownError"),
              ),
          },
        );
      },
    );
  }, [member, updateRole, wsId, t]);

  const onRemovePress = useCallback(() => {
    if (!member || !wsSlug || !workspace) return;
    Alert.alert(
      t("members.detail.removeTitle", { name: member.name }),
      t("members.detail.removeMessage", {
        name: member.name,
        workspace: workspace.name,
      }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("members.detail.removeAction"),
          style: "destructive",
          onPress: () => {
            removeMember.mutate(member.id, {
              onSuccess: () => router.back(),
              onError: (err) =>
                Alert.alert(
                  t("members.detail.removeFailed"),
                  err instanceof Error ? err.message : t("common.unknownError"),
                ),
            });
          },
        },
      ],
    );
  }, [member, wsSlug, workspace, removeMember, t]);

  return (
    <>
      <Stack.Screen options={{ title: t("screen.members") }} />
      <ScrollView
        className="flex-1 bg-background"
        contentContainerClassName="pb-8"
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => {
              void refetch();
              // The actor-issues panel queries are actor-scoped — refresh the
              // shared prefix so a pull updates the member's Issues surface.
              queryClient.invalidateQueries({ queryKey: issueKeys.actorAll(wsId) });
            }}
            tintColor={theme.mutedForeground}
          />
        }
      >
        {isLoading && !member ? (
          <View className="flex-1 items-center justify-center pt-24">
            <ActivityIndicator />
          </View>
        ) : !member ? (
          <View className="px-6 pt-16 items-center gap-3">
            <Ionicons name="person-outline" size={32} color={theme.mutedForeground} />
            <Text className="text-sm text-muted-foreground text-center">
              {t("members.emptyTitle")}
            </Text>
          </View>
        ) : (
          <>
            {/* Header */}
            <View className="px-4 pt-4 flex-row items-center gap-3">
              <ActorAvatar type="member" id={member.user_id} size={56} />
              <View className="flex-1 min-w-0 gap-0.5">
                <View className="flex-row items-center gap-2">
                  <Text
                    className="flex-1 text-base font-semibold text-foreground"
                    numberOfLines={1}
                  >
                    {member.name}
                  </Text>
                  <RoleBadge role={member.role} />
                </View>
                <Text className="text-sm text-muted-foreground" numberOfLines={1}>
                  {member.email}
                </Text>
              </View>
            </View>

            {/* Profile */}
            <SectionTitle>{t("members.detail.profile")}</SectionTitle>
            <View className="px-4 gap-3">
              <PropertyRow label={t("members.detail.role")} icon="shield-outline">
                <Text className="flex-1 text-sm text-foreground">
                  {t(`members.role.${member.role}`)}
                </Text>
              </PropertyRow>
              <PropertyRow label={t("members.detail.joined")} icon="time-outline">
                <Text className="flex-1 text-sm text-foreground">
                  {formatDateTime(member.created_at)}
                </Text>
              </PropertyRow>
            </View>

            {/* Issues — this member's assigned/created issues (web
                common/actor-issues-panel.tsx, member-detail page). */}
            <ActorIssuesPanel
              actorType="member"
              actorId={member.user_id}
              sectionTitleKey="members.detail.issues"
            />

            {/* Manage (owner/admin, non-self, non-owner target only) */}
            {canEditRole || canRemove ? (
              <>
                <SectionTitle>{t("members.detail.manage")}</SectionTitle>
                <View className="px-4 gap-2">
                  {canEditRole ? (
                    <ManageRow
                      icon="swap-horizontal-outline"
                      label={t("members.detail.changeRole")}
                      tint={theme.foreground}
                      onPress={onChangeRolePress}
                    />
                  ) : null}
                  {canRemove ? (
                    <ManageRow
                      icon="person-remove-outline"
                      label={t("members.detail.removeAction")}
                      tint={theme.destructive}
                      onPress={onRemovePress}
                    />
                  ) : null}
                </View>
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </>
  );
}

function RoleBadge({ role }: { role: MemberRole }) {
  const { t } = useTranslation();
  return (
    <View
      className={cn(
        "px-2 py-0.5 rounded-full border border-border",
        ROLE_BADGE[role],
      )}
    >
      <Text className="text-[11px] font-medium">
        {t(`members.role.${role}`)}
      </Text>
    </View>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text className="px-4 pt-5 pb-2 text-xs uppercase tracking-wider text-muted-foreground font-medium">
      {children}
    </Text>
  );
}

function PropertyRow({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  children: React.ReactNode;
}) {
  const { colorScheme } = useColorScheme();
  return (
    <View className="flex-row items-center gap-2">
      <Ionicons
        name={icon}
        size={15}
        color={THEME[colorScheme].mutedForeground}
      />
      <Text className="w-20 text-xs text-muted-foreground">{label}</Text>
      <View className="flex-1 flex-row items-center">{children}</View>
    </View>
  );
}

function ManageRow({
  icon,
  label,
  tint,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  tint: string;
  onPress: () => void;
}) {
  const { colorScheme } = useColorScheme();
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-2 rounded-lg border border-border bg-background px-3 py-3 active:bg-secondary"
    >
      <Ionicons name={icon} size={17} color={tint} />
      <Text className="flex-1 text-sm" style={{ color: tint }}>
        {label}
      </Text>
      <Ionicons
        name="chevron-forward"
        size={14}
        color={THEME[colorScheme].mutedForeground}
      />
    </Pressable>
  );
}